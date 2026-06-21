// Find-or-promote a user_generation into the curated `looks` catalog.
//
// Old behaviour (split across /admin/data inline button + /admin/publish/$id)
// created a brand new looks row on every Publish click. Combined with the
// Unpublished tab reading from user_generations directly, a second click
// silently produced a duplicate. The new flow centralises everything here:
//
//   • Look up the existing looks row for this generation via the
//     source_generation_id column (added in migration
//     20260602_looks_source_generation_id).
//   • If one exists, flip its status to 'live' and update creator
//     attribution + audit fields. NO new row is created.
//   • If none exists, call manage-looks to create one, then stamp the
//     source_generation_id (so the next click round-trips through the
//     same dedupe branch).
//
// Unpublish goes through `unpublishLook(lookId)` — sets status='draft'
// and flips is_published on the source generation so the Unpublished
// tab re-shows the look.
//
// Both helpers also keep user_generations.is_published in sync so the
// Unpublished tab query (which filters out generations whose source
// already has a live look) and the analytics RPC (which counts
// is_published) read the same source of truth.

import { supabase } from '~/utils/supabase';
import { createLook, addProductToLook } from '~/services/manage-looks';
import { setGenerationPublished } from '~/services/user-generations';
import { generateAndStorePoster } from '~/utils/video-poster';

export interface PromoteInput {
  generationId: string;
  /** Source user_generation owner — becomes the published look's user_id. */
  creatorUserId: string | null;
  videoUrl: string | null;
  /** Used to build the look title when creating a brand new row. */
  creatorLabel: string;
  /** Used to build the look title when creating a brand new row. */
  style: string;
  /** Audience filter for new rows. Defaults to 'unisex' if undefined. */
  gender?: 'men' | 'women' | 'unisex';
  /** Custom title; falls back to "<creatorLabel>'s <style> look". */
  titleOverride?: string;
  /** Custom description; falls back to "Promoted from generation <id>". */
  descriptionOverride?: string;
  /** Products to attach when creating a fresh row. Ignored on republish. */
  products?: Array<{ id: string }>;
  /** Status for a freshly-created row. Defaults to 'live' (admin publish).
   *  The auto-add-to-My-Catalog flow passes 'archived' so a generated look
   *  shows up Inactive in the creator's catalog without going live. */
  status?: 'live' | 'archived';
}

export interface PromoteResult {
  /** id of the looks row (existing or newly created). */
  lookId: string;
  /** Whether a brand new looks row was created. */
  created: boolean;
}

/**
 * Promote a user_generation into the curated catalog. Idempotent — re-running
 * for the same generationId flips the existing row to status='live' rather
 * than creating a duplicate.
 */
export async function promoteGenerationToLook(input: PromoteInput): Promise<PromoteResult> {
  if (!supabase) throw new Error('Supabase client not configured');

  // Step 1 — find an existing looks row for this generation.
  const { data: existing, error: lookupErr } = await supabase
    .from('looks')
    .select('id')
    .eq('source_generation_id', input.generationId)
    .maybeSingle();
  if (lookupErr) throw new Error(`Lookup failed: ${lookupErr.message}`);

  const targetStatus = input.status ?? 'live';

  if (existing?.id) {
    // Auto-archive is idempotent and non-clobbering: if a row already exists
    // for this generation (it may already be live / published), leave its
    // status alone — the only goal is "a row exists in My Catalog".
    if (targetStatus === 'archived') {
      return { lookId: existing.id, created: false };
    }
    // Re-publish path: just flip the existing row to live + sync
    // creator attribution. The looks_creative row already exists, so
    // there's nothing to re-insert.
    const updates: Record<string, unknown> = { status: 'live' };
    if (input.creatorUserId) {
      updates.user_id = input.creatorUserId;
      // Let the looks_sync_creator_handle_upd trigger backfill from
      // creators on the user_id change. Setting it to null here is
      // safe — the trigger fires BEFORE the row is read by anything
      // downstream.
      updates.creator_handle = null;
    }
    const { data: updated, error: updErr } = await supabase
      .from('looks')
      .update(updates)
      .eq('id', existing.id)
      .select('id, status')
      .maybeSingle();
    if (updErr) throw new Error(`Update failed: ${updErr.message}`);
    if (!updated || updated.status !== 'live') {
      throw new Error('Republish UPDATE affected 0 rows (likely RLS block)');
    }
    await syncCreatedBy(existing.id);
    await flipGenerationFlag(input.generationId, true);
    return { lookId: existing.id, created: false };
  }

  // Step 2 — first-time publish. Create + attach products + insert the
  // primary creative + flip status to 'live'.
  const title = input.titleOverride
    || `${input.creatorLabel}’s ${input.style} look`;
  const description = input.descriptionOverride
    || `Promoted from generation ${input.generationId}`;

  const { data: look } = await createLook({
    title,
    description,
    gender: input.gender ?? 'unisex',
  });

  // Stamp the source_generation_id immediately so a parallel click can't
  // race past the dedupe lookup. The unique partial index on
  // source_generation_id will reject the second attempt at this update,
  // surfacing a 23505 instead of silently creating a duplicate.
  const { error: stampErr } = await supabase
    .from('looks')
    .update({ source_generation_id: input.generationId })
    .eq('id', look.id);
  if (stampErr) throw new Error(`Source-gen stamp failed: ${stampErr.message}`);

  // Best-effort product attach, sequential with one retry each. A single bad
  // product shouldn't fail the whole publish — the admin can retry from the
  // Products dropdown, and ensureGenerationsInCatalog self-heals an empty look
  // on the next My Catalog open. Sequential (not Promise.all): the original
  // concurrent burst of edge calls is what a transient blip / edge cold-start
  // took down all-at-once, leaving looks with zero products.
  await attachProducts(look.id, input.products ?? []);

  // Insert the primary creative + warm the poster so the consumer feed
  // and admin Published tab can render the row immediately. The unique
  // partial index on looks_creative.video_url (where is_primary=true)
  // blocks a duplicate primary pointing at the same video — if we hit
  // 23505 here, an earlier promotion of this same video already
  // happened and the keeper is somewhere else; bail loudly so the
  // caller can repoint instead of producing a phantom row.
  if (input.videoUrl) {
    const { data: creative, error: creativeErr } = await supabase
      .from('looks_creative')
      .insert({ look_id: look.id, video_url: input.videoUrl, is_primary: true })
      .select('id')
      .single();
    if (creativeErr) {
      if (creativeErr.code === '23505') {
        throw new Error(`This video is already attached to another look. Find that look in Published / Unpublished and use it instead of creating a new one.`);
      }
      throw new Error(`looks_creative insert failed: ${creativeErr.message}`);
    }
    if (creative?.id) {
      void generateAndStorePoster(look.id, creative.id, input.videoUrl);
    }
  }

  // Set the look's status (live for publish, archived for auto-add) +
  // reassign user_id to the actual creator.
  const updates: Record<string, unknown> = { status: targetStatus };
  if (input.creatorUserId) {
    updates.user_id = input.creatorUserId;
    updates.creator_handle = null;
  }
  const { data: statusRow, error: statusErr } = await supabase
    .from('looks')
    .update(updates)
    .eq('id', look.id)
    .select('id, status')
    .maybeSingle();
  if (statusErr) throw new Error(`Status update failed: ${statusErr.message}`);
  if (!statusRow || statusRow.status !== targetStatus) {
    throw new Error('Status update affected 0 rows (likely RLS block)');
  }

  await syncCreatedBy(look.id);
  // Only mark the generation published when it actually goes live; an
  // auto-archived look is still "unpublished" for the admin tabs.
  if (targetStatus === 'live') await flipGenerationFlag(input.generationId, true);
  return { lookId: look.id, created: true };
}

/**
 * Reconcile My Catalog with the creator's generations: ensure EVERY completed
 * generation has a looks row (archived/Inactive if it isn't already live).
 *
 * The per-generation auto-add in /generate only fires while the creator is
 * sitting on the result screen at the moment it finishes — so looks that
 * completed after they navigated away (or were made before auto-add existed)
 * never landed in My Catalog. Running this when My Catalog opens backfills
 * those gaps. Idempotent: promoteGenerationToLook keys off
 * source_generation_id, so existing rows are left untouched.
 *
 * Returns the number of looks rows newly created.
 */
export async function ensureGenerationsInCatalog(): Promise<number> {
  if (!supabase) return 0;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return 0;

  // 1. The creator's completed generations (have a playable video).
  const { data: gens } = await supabase
    .from('user_generations')
    .select('id, video_url, style, display_name')
    .eq('user_id', uid)
    .eq('status', 'done')
    .not('video_url', 'is', null);
  const completed = (gens || []) as Array<{
    id: string; video_url: string | null; style: string | null; display_name: string | null;
  }>;
  if (completed.length === 0) return 0;
  const ids = completed.map(g => g.id);

  // 2. Existing looks for these generations — id + which generation they came
  //    from (so step 5 can repair an existing look that lost its products).
  const { data: existingRows } = await supabase
    .from('looks')
    .select('id, source_generation_id')
    .in('source_generation_id', ids);
  const existing = (existingRows || []) as Array<{ id: string; source_generation_id: string }>;
  const lookByGen = new Map(existing.map(r => [r.source_generation_id, r.id]));

  // 3. Products picked across ALL these generations (one round-trip) — used both
  //    to attach on create and to repair existing looks that came out empty.
  const { data: prodRows } = await supabase
    .from('user_generation_products')
    .select('generation_id, product_id, sort_order')
    .in('generation_id', ids)
    .order('sort_order');
  const productsByGen = new Map<string, Array<{ id: string }>>();
  for (const r of (prodRows || []) as Array<{ generation_id: string; product_id: string }>) {
    const arr = productsByGen.get(r.generation_id) || [];
    arr.push({ id: r.product_id });
    productsByGen.set(r.generation_id, arr);
  }

  // 4. Create the missing archived looks. Sequential so we don't hammer the
  //    manage-looks edge function or race RLS; failures skip, never throw.
  const missing = completed.filter(g => !lookByGen.has(g.id));
  let created = 0;
  for (const g of missing) {
    try {
      const res = await promoteGenerationToLook({
        generationId: g.id,
        creatorUserId: uid,
        videoUrl: g.video_url,
        creatorLabel: g.display_name || 'You',
        style: g.style || 'look',
        gender: 'unisex',
        status: 'archived',
        products: productsByGen.get(g.id) || [],
      });
      if (res.created) created++;
    } catch { /* keep going — one bad generation shouldn't block the rest */ }
  }

  // 5. Self-heal: a look that ended up with ZERO products while its generation
  //    actually had some is the swallowed-attach failure (a network blip / edge
  //    cold-start during the original concurrent attach). Re-attach now. Guarded
  //    to ONLY-empty looks so a look whose products were deliberately removed is
  //    never silently repopulated.
  const existingWithProducts = existing.filter(
    r => (productsByGen.get(r.source_generation_id)?.length ?? 0) > 0,
  );
  if (existingWithProducts.length > 0) {
    const { data: lpRows } = await supabase
      .from('look_products')
      .select('look_id')
      .in('look_id', existingWithProducts.map(r => r.id));
    const hasProducts = new Set((lpRows || []).map(r => (r as { look_id: string }).look_id));
    for (const r of existingWithProducts) {
      if (hasProducts.has(r.id)) continue; // already populated — leave it
      await attachProducts(r.id, productsByGen.get(r.source_generation_id) || []);
    }
  }

  return created;
}

/**
 * Move a published look back to the Unpublished tab. Status drops to
 * 'draft' and the source generation's is_published flag flips off so
 * the Unpublished tab re-surfaces it.
 *
 * Pass the generationId explicitly so this works even when the look
 * row's source_generation_id hasn't been backfilled (legacy seed rows).
 */
export async function unpublishLook(lookId: string, generationId?: string | null): Promise<void> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data: updated, error: updErr } = await supabase
    .from('looks')
    .update({ status: 'draft' })
    .eq('id', lookId)
    .select('id, status, source_generation_id')
    .maybeSingle();
  if (updErr) throw new Error(`Unpublish failed: ${updErr.message}`);
  if (!updated) {
    throw new Error('Unpublish affected 0 rows (likely RLS block)');
  }
  const gen = generationId ?? updated.source_generation_id;
  if (gen) await flipGenerationFlag(gen as string, false);
}

// ── helpers ──────────────────────────────────────────────────────────────

/**
 * Attach products to a look one-at-a-time, retrying each once on failure.
 * The attach goes through the manage-looks edge function (addProductToLook);
 * a transient network blip / edge cold-start during the previous all-at-once
 * (Promise.all) attach is what silently left some looks with zero products.
 * Sequential + a single retry makes that path resilient; remaining failures
 * are logged (not thrown) and get a second chance via the self-heal pass in
 * ensureGenerationsInCatalog. Returns how many landed.
 */
async function attachProducts(lookId: string, products: Array<{ id: string }>): Promise<number> {
  let ok = 0;
  for (const p of products) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await addProductToLook(lookId, { product_id: p.id });
        ok++;
        break;
      } catch (err) {
        if (attempt === 1) console.warn('[promote] attachProducts failed after retry:', p.id, err);
      }
    }
  }
  return ok;
}

async function flipGenerationFlag(generationId: string, isPublished: boolean): Promise<void> {
  try {
    const { error } = await setGenerationPublished(generationId, isPublished);
    if (error) console.warn('[promote] setGenerationPublished:', error);
  } catch (err) {
    console.warn('[promote] setGenerationPublished threw:', err);
  }
}

async function syncCreatedBy(lookId: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser?.id) return;
    const { error } = await supabase
      .from('looks')
      .update({ created_by: authUser.id })
      .eq('id', lookId);
    if (error) console.warn('[promote] created_by:', error.message);
  } catch (err) {
    console.warn('[promote] created_by threw:', err);
  }
}

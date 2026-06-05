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

  // Best-effort product attach. A single bad product shouldn't fail
  // the whole publish — the admin can retry from the Products dropdown.
  await Promise.all((input.products ?? []).map(p =>
    addProductToLook(look.id, { product_id: p.id }).catch(err => {
      console.warn('[promoteGenerationToLook] addProductToLook failed:', err);
    })
  ));

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

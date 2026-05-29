import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { createLook, addProductToLook } from '~/services/manage-looks';
import { invalidateLooksCache } from '~/services/looks';
import { setGenerationPublished } from '~/services/user-generations';
import { generateAndStorePoster } from '~/utils/video-poster';

/* /admin/publish/:id - promote a user-generated look into the curated
 * catalog. Reached via the per-row Publish button on
 * /admin/data?tab=looks (Unpublished tab) and the Published tab.
 * Full screen instead of a modal so the admin has space to review
 * the look + product details before pushing live. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PublishProduct {
  id: string;
  name: string;
  brand: string;
  price: string | null;
  image_url: string | null;
  role_tag: string | null;
}

interface PublishDraft {
  generationId: string;
  videoUrl: string | null;
  style: string;
  status: string;
  creatorName: string;
  creatorAvatar: string | null;
  creatorUserId: string | null;
  products: PublishProduct[];
}

export default function AdminPublishScreen() {
  const params = useParams();
  const navigate = useNavigate();
  const id = params.id || '';

  const [draft, setDraft] = useState<PublishDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gender, setGender] = useState<'men' | 'women' | 'unisex'>('unisex');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    if (!UUID_RE.test(id)) {
      setError('That id doesn’t look like an unpublished generation. Pull the Publish button from /admin/data first.');
      setLoading(false);
      return;
    }
    if (!supabase) {
      setError('Supabase not configured - can’t load the unpublished look.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: gen, error: genErr }, { data: prodRows, error: prodErr }] = await Promise.all([
        supabase
          .from('user_generations')
          .select('id, style, video_url, status, user_id')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('user_generation_products')
          .select('product_id, role_tag, sort_order, products(id, name, brand, price, image_url)')
          .eq('generation_id', id)
          .order('sort_order'),
      ]);
      if (cancelled) return;
      if (genErr || !gen) {
        setError(genErr?.message || 'Generation not found.');
        setLoading(false);
        return;
      }
      let creatorName = 'Unknown';
      let creatorAvatar: string | null = null;
      if (gen.user_id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, email, avatar_url, gender')
          .eq('id', gen.user_id)
          .maybeSingle();
        creatorName = prof?.full_name || prof?.email || 'Unknown';
        creatorAvatar = prof?.avatar_url || null;
        // Default the audience radio to the creator's own gender —
        // earlier the form defaulted to 'unisex' so every published
        // look slipped past the men/women filter for the wrong
        // shopper. Admin can still override before clicking Publish.
        if (prof?.gender === 'male')   setGender('men');
        else if (prof?.gender === 'female') setGender('women');
      }
      if (prodErr) {
        setError(prodErr.message);
        setLoading(false);
        return;
      }
      const products: PublishProduct[] = ((prodRows || []) as unknown as Array<{
        product_id: string;
        role_tag: string | null;
        sort_order: number;
        products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null } | null;
      }>)
        .filter(r => !!r.products)
        .map(r => ({
          id: r.products!.id,
          name: r.products!.name || ' - ',
          brand: r.products!.brand || ' - ',
          price: r.products!.price,
          image_url: r.products!.image_url,
          role_tag: r.role_tag,
        }));
      setDraft({
        generationId: gen.id,
        videoUrl: gen.video_url,
        style: gen.style,
        status: gen.status,
        creatorName,
        creatorAvatar,
        creatorUserId: gen.user_id ?? null,
        products,
      });
      setTitle(`${creatorName}’s ${gen.style} look`);
      setDescription(`Promoted from generation ${gen.id}`);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const submit = async () => {
    if (!draft || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const { data: look } = await createLook({
        title: title.trim() || `${draft.creatorName}’s ${draft.style} look`,
        description: description.trim() || undefined,
        gender,
      });
      // Best-effort attach products. Ignore individual product
      // failures so a single bad row doesn't fail the whole publish.
      await Promise.all(draft.products.map(p =>
        addProductToLook(look.id, { product_id: p.id }).catch(err => {
          console.warn('[publish] addProductToLook failed:', err);
        })
      ));
      // The Content/Looks list joins `looks_creative!inner` and only
      // surfaces looks with status='live' - createLook writes draft
      // and never inserts a creative row, so without these two
      // follow-ups the published look is silently dropped from the
      // Published tab.
      if (supabase && draft.videoUrl) {
        const { data: creativeData, error: creativeErr } = await supabase
          .from('looks_creative')
          .insert({ look_id: look.id, video_url: draft.videoUrl, is_primary: true })
          .select('id')
          .single();
        if (creativeErr) console.warn('[publish] looks_creative insert failed:', creativeErr.message);
        if (creativeData?.id) {
          void generateAndStorePoster(look.id, creativeData.id, draft.videoUrl);
        }
      }
      if (supabase) {
        // Move ownership to the persona who generated the source video
        // (createLook stamped user_id = auth.uid() = admin). The DB
        // trigger `looks_sync_creator_handle` will fill creator_handle
        // from the matching creators row.
        const updates: Record<string, unknown> = { status: 'live' };
        if (draft.creatorUserId) {
          updates.user_id = draft.creatorUserId;
          updates.creator_handle = null;
        }
        const { error: statusErr } = await supabase
          .from('looks')
          .update(updates)
          .eq('id', look.id);
        if (statusErr) console.warn('[publish] status update failed:', statusErr.message);

        // Preserve the publisher in created_by so the audit trail
        // survives the user_id move.
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser?.id) {
          const { error: createdByErr } = await supabase
            .from('looks')
            .update({ created_by: authUser.id })
            .eq('id', look.id);
          if (createdByErr) console.warn('[publish] created_by update failed:', createdByErr.message);
        }
      }
      // Flip is_published on the source generation so /admin/data's
      // Unpublished tab stops showing this row — earlier the publish
      // flow created a new looks row but left the user_generations
      // row alone, so admins saw the same generation in BOTH the
      // Unpublished tab and the Published tab.
      const { error: flipErr } = await setGenerationPublished(draft.generationId, true);
      if (flipErr) console.warn('[publish] setGenerationPublished failed:', flipErr);

      // Drop the cached promise so the next /admin/data render
      // refetches and shows the new row in the Published tab.
      invalidateLooksCache();
      setPublished({ id: look.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return <div className="admin-page"><div className="admin-empty">Loading the look…</div></div>;
  }

  if (error && !draft) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1>Publish</h1>
        </div>
        <div className="admin-empty" style={{ color: '#991b1b' }}>{error}</div>
        <Link to="/admin/data?tab=looks&looks=unpublished" className="admin-btn admin-btn-secondary">
          ← Back to unpublished
        </Link>
      </div>
    );
  }

  if (published) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1>Published</h1>
          <p className="admin-page-subtitle">The look is now live in the curated catalog.</p>
        </div>
        <div className="admin-empty" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', padding: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#dcfce7', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600 }}>Look {published.id} created.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-btn admin-btn-secondary" onClick={() => navigate('/admin/data?tab=looks&looks=unpublished')}>
              Back to unpublished
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={() => {
                // Hard reload so admin/content remounts and the
                // (just-invalidated) looks cache refetches with the
                // new row included.
                window.location.assign('/admin/data?tab=looks');
              }}
            >
              See it in Looks
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!draft) return null;

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1>Publish look</h1>
          <p className="admin-page-subtitle">
            Review and promote this user-generated look into the curated catalog.
          </p>
        </div>
        <Link to="/admin/data?tab=looks&looks=unpublished" className="admin-btn admin-btn-secondary">
          ← Cancel
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 24, marginTop: 16, alignItems: 'flex-start' }}>
        <div style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 12, overflow: 'hidden', background: '#000', position: 'sticky', top: 20 }}>
          {draft.videoUrl ? (
            <video src={draft.videoUrl} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              No video
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {draft.creatorAvatar ? (
              <img src={draft.creatorAvatar} alt={draft.creatorName} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e5e7eb' }} />
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{draft.creatorName}</div>
              <div style={{ fontSize: 12, color: '#666' }}>
                {draft.style} · {draft.status} · {draft.products.length} product{draft.products.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#666' }}>Title</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#666' }}>Description</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
            />
          </label>

          <fieldset style={{ border: '0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <legend style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#666' }}>Audience</legend>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['unisex', 'women', 'men'] as const).map(g => (
                <button
                  key={g}
                  type="button"
                  className={`admin-tab ${gender === g ? 'active' : ''}`}
                  onClick={() => setGender(g)}
                  style={{ textTransform: 'capitalize' }}
                >
                  {g}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <h3 style={{ margin: '8px 0 6px', fontSize: 13, fontWeight: 600 }}>Products in this look</h3>
            {draft.products.length === 0 ? (
              <div style={{ padding: 16, fontSize: 13, color: '#666', background: '#f9fafb', borderRadius: 8 }}>
                No products linked. The look will publish without items.
              </div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {draft.products.map(p => (
                  <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, background: '#f9fafb', border: '1px solid #f1f5f9' }}>
                    {p.image_url ? (
                      <img src={p.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: 6, background: '#e5e7eb' }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{p.brand}{p.role_tag ? ` · ${p.role_tag}` : ''}</div>
                    </div>
                    {p.price && <div style={{ fontSize: 12, fontWeight: 600 }}>{p.price}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 8, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
            <Link to="/admin/data?tab=looks&looks=unpublished" className="admin-btn admin-btn-secondary">
              Cancel
            </Link>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={submit}
              disabled={publishing || draft.status !== 'done'}
              title={draft.status !== 'done' ? `Can’t publish - status is ${draft.status}` : undefined}
            >
              {publishing ? 'Publishing…' : 'Publish to catalog'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

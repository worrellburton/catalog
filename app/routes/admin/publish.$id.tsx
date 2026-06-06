import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { invalidateLooksCache } from '~/services/looks';
import { promoteGenerationToLook } from '~/services/promote-generation';
import { sortByGarmentRole } from '~/utils/garmentOrder';

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
  // Pipeline introspection — surfaced in the Generation pipeline
  // panel so the admin can see what the model received without
  // jumping back to /admin/data.
  prompt: string | null;
  model: 'fast' | 'pro' | null;
  veoModel: string | null;
  falRequestId: string | null;
  heightLabel: string | null;
  ageLabel: string | null;
  storagePath: string | null;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
  /** Reference photos the user uploaded for this generation. */
  uploads: Array<{ id: string; url: string }>;
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
      const [
        { data: gen, error: genErr },
        { data: prodRows, error: prodErr },
        { data: uploadRows },
      ] = await Promise.all([
        supabase
          .from('user_generations')
          .select('id, style, video_url, status, user_id, prompt, model, veo_model, fal_request_id, height_label, age_label, storage_path, completed_at, created_at, error')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('user_generation_products')
          .select('product_id, role_tag, sort_order, products(id, name, brand, price, image_url)')
          .eq('generation_id', id)
          .order('sort_order'),
        // Face photos the user picked for the gen. Joined via the
        // link table so we surface them in upload-order.
        supabase
          .from('user_generation_uploads')
          .select('upload_id, sort_order, user_uploads(id, public_url)')
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
      // Sort head-to-toe (hat → top → bottom → shoes → accessories) so
      // the reviewer always sees the outfit read top-to-bottom the way
      // a stylist would call it out, regardless of the user_generation
      // row's sort_order — which mirrors pick order, not body order.
      const products: PublishProduct[] = sortByGarmentRole(
        ((prodRows || []) as unknown as Array<{
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
          }))
      );
      const uploads = ((uploadRows || []) as unknown as Array<{
        upload_id: string;
        sort_order: number;
        user_uploads: { id: string; public_url: string } | null;
      }>)
        .filter(r => !!r.user_uploads?.public_url)
        .map(r => ({ id: r.user_uploads!.id, url: r.user_uploads!.public_url }));
      setDraft({
        generationId: gen.id,
        videoUrl: gen.video_url,
        style: gen.style,
        status: gen.status,
        creatorName,
        creatorAvatar,
        creatorUserId: gen.user_id ?? null,
        products,
        prompt: gen.prompt ?? null,
        model: gen.model ?? null,
        veoModel: gen.veo_model ?? null,
        falRequestId: gen.fal_request_id ?? null,
        heightLabel: gen.height_label ?? null,
        ageLabel: gen.age_label ?? null,
        storagePath: gen.storage_path ?? null,
        completedAt: gen.completed_at ?? null,
        createdAt: gen.created_at,
        error: gen.error ?? null,
        uploads,
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
      // promoteGenerationToLook is the single source of truth for the
      // generation → looks pipeline. Idempotent — a second submit for
      // the same generation flips the existing looks row to status=
      // 'live' instead of creating a duplicate. The Unpublished tab
      // now de-dupes against source_generation_id so the admin can
      // only land here for generations that aren't already live, but
      // the dedupe inside promote keeps us safe under refresh races.
      const { lookId } = await promoteGenerationToLook({
        generationId: draft.generationId,
        creatorUserId: draft.creatorUserId,
        videoUrl: draft.videoUrl,
        creatorLabel: draft.creatorName,
        style: draft.style,
        gender,
        titleOverride: title.trim() || undefined,
        descriptionOverride: description.trim() || undefined,
        products: draft.products.map(p => ({ id: p.id })),
      });
      invalidateLooksCache();
      setPublished({ id: lookId });
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

      <div className="admin-publish-grid">
        <div className="admin-publish-preview" style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 12, overflow: 'hidden', background: '#000', position: 'sticky', top: 20 }}>
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

      {/* Generation pipeline — visible audit trail of what the model
          received. Replaces a hidden "drill into /admin/data and
          expand the row" flow so the reviewer can see prompt + face
          photos + model tier without leaving this page. */}
      <GenerationPipelinePanel draft={draft} />
    </div>
  );
}

// ── Generation pipeline panel ────────────────────────────────────────────
// Visual journey of the user_generation row: face photos → picked
// products → prompt → model call → video → status. Lives here (not in
// admin/data) because it's the publish-review surface where the admin
// makes the keep / reject decision and needs the most context.

function GenerationPipelinePanel({ draft }: { draft: PublishDraft }) {
  const modelLabel = draft.model
    ? draft.model === 'pro' ? 'Pro (Seedance Pro)' : 'Fast (Seedance Lite)'
    : '—';
  const modelTier = draft.veoModel
    || (draft.model === 'pro' ? 'bytedance/seedance-2.0/reference-to-video'
        : draft.model === 'fast' ? 'bytedance/seedance-2.0/fast/reference-to-video'
        : null);

  type NodeStatus = 'done' | 'active' | 'pending' | 'failed';
  const statusOf = (i: number): NodeStatus => {
    // 0 uploads, 1 products, 2 prompt, 3 model call, 4 video, 5 status
    if (draft.status === 'failed') {
      if (i < 3) return 'done';
      if (i === 3) return 'failed';
      return 'pending';
    }
    if (draft.status === 'done') return 'done';
    if (i <= 2) return 'done';
    if (i === 3) return 'active';
    return 'pending';
  };

  const nodes = [
    {
      label: 'Face photos',
      sub: `${draft.uploads.length} uploaded`,
      detail: draft.uploads.length > 0
        ? 'Reference photos from /generate (user_uploads)'
        : 'No reference photos found',
    },
    {
      label: 'Products',
      sub: `${draft.products.length} item${draft.products.length === 1 ? '' : 's'}`,
      detail: 'user_generation_products — role-tagged for prompt slotting',
    },
    {
      label: 'Prompt',
      sub: draft.style,
      detail: draft.prompt
        ? `${draft.prompt.length.toLocaleString()} chars`
        : 'Assembled from style preset + role tags',
    },
    {
      label: 'Model call',
      sub: modelLabel,
      detail: draft.falRequestId
        ? `fal_id ${draft.falRequestId.slice(0, 10)}…`
        : 'Fal queue submission',
    },
    {
      label: 'Video',
      sub: draft.videoUrl ? 'Stored' : 'Pending',
      detail: draft.storagePath || (draft.videoUrl ? 'Hosted on Fal CDN' : '—'),
    },
    {
      label: 'Status',
      sub: draft.status,
      detail: draft.completedAt ? new Date(draft.completedAt).toLocaleString() : '—',
    },
  ];

  return (
    <div className="admin-model-panel" style={{ marginTop: 32 }}>
      <div className="admin-model-panel-head">
        <h3 className="admin-products-title" style={{ margin: 0 }}>Generation pipeline</h3>
        <span className="admin-model-panel-meta">
          gen <code>{draft.generationId.slice(0, 8)}…</code> · created {new Date(draft.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="admin-model-flow">
        {nodes.map((n, i) => (
          <div key={n.label} className="admin-model-flow-step">
            <div className={`admin-model-node admin-model-node--${statusOf(i)}`}>
              <div className="admin-model-node-num">{i + 1}</div>
              <div className="admin-model-node-body">
                <div className="admin-model-node-label">{n.label}</div>
                <div className="admin-model-node-sub">{n.sub}</div>
                <div className="admin-model-node-detail">{n.detail}</div>
              </div>
            </div>
            {i < nodes.length - 1 && (
              <svg className="admin-model-arrow" width="22" height="14" viewBox="0 0 22 14" fill="none">
                <path d="M1 7H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M14 1L20 7L14 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ))}
      </div>

      {draft.uploads.length > 0 && (
        <div className="admin-model-output" style={{ marginTop: 16 }}>
          <div className="admin-model-card-label">Uploaded reference photos ({draft.uploads.length})</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            {draft.uploads.map(u => (
              <a
                key={u.id}
                href={u.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open full-size in a new tab"
                style={{ display: 'block', width: 90, aspectRatio: '3 / 4', borderRadius: 8, overflow: 'hidden', background: '#f1f5f9', border: '1px solid #e5e7eb' }}
              >
                <img
                  src={u.url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="admin-model-grid" style={{ marginTop: 16 }}>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Model</div>
          <div className="admin-model-card-value">{modelLabel}</div>
          {modelTier && <div className="admin-model-card-sub">{modelTier}</div>}
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Style preset</div>
          <div className="admin-model-card-value" style={{ textTransform: 'capitalize' }}>{draft.style}</div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Height</div>
          <div className="admin-model-card-value">{draft.heightLabel || '—'}</div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Age band</div>
          <div className="admin-model-card-value">{draft.ageLabel || '—'}</div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Fal request id</div>
          <div className="admin-model-card-value admin-model-mono">{draft.falRequestId || '—'}</div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Completed at</div>
          <div className="admin-model-card-value">
            {draft.completedAt ? new Date(draft.completedAt).toLocaleString() : '—'}
          </div>
        </div>
      </div>

      <div className="admin-model-prompt">
        <div className="admin-model-card-label">Prompt sent to {modelLabel}</div>
        <pre className="admin-model-prompt-body">
          {draft.prompt || '— no prompt recorded —'}
        </pre>
      </div>

      {draft.videoUrl && (
        <div className="admin-model-output">
          <div className="admin-model-card-label">Output video</div>
          <a
            href={draft.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-model-mono admin-model-link"
          >
            {draft.videoUrl}
          </a>
          {draft.storagePath && (
            <div className="admin-model-card-sub admin-model-mono">{draft.storagePath}</div>
          )}
        </div>
      )}

      {draft.error && (
        <div className="admin-model-error">
          <div className="admin-model-card-label">Error</div>
          <pre className="admin-model-prompt-body admin-model-error-body">{draft.error}</pre>
        </div>
      )}
    </div>
  );
}

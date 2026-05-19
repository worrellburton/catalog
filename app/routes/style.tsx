import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import '~/styles/style-page.css';
import { useAuth } from '~/hooks/useAuth';
import { listUserUploads, getUserSlots, type UserUpload } from '~/services/user-generations';
import { getUserHeightAge, updateUserHeightAge } from '~/services/profiles';
import { updateUserGender, type UserGender } from '~/services/genders';
import { getLensIngestCounts } from '~/services/lens-search';
import { supabase } from '~/utils/supabase';
import { HEIGHT_OPTIONS, AGE_OPTIONS } from '~/constants/stats';

// Lens sheet is the only consumer of the SerpAPI Google Lens client +
// product ingest path, so lazy-load it so the rest of the Style page
// stays light when the user never taps "Shop this look."
const StyleLensSheet = lazy(() => import('~/components/StyleLensSheet'));
import {
  createStyleGeneration,
  listStyleGenerationsWithImages,
  deleteStyleGeneration,
  deleteStyleGenerationImage,
  setStyleImageLiked,
  type StyleGenerationImage,
  type StyleGenerationResult,
} from '~/services/style-generations';

const OCCASION_SUGGESTIONS = [
  'a first date',
  'work',
  'a wedding',
  'casual weekends',
  'travel',
  'a night out',
];

interface ProfileBadgeBits {
  heightCm: number | null;
  heightLabel: string | null;
  ageLabel: string | null;
  gender: UserGender;
}

export default function StylePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [uploads, setUploads] = useState<UserUpload[]>([]);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [profileBits, setProfileBits] = useState<ProfileBadgeBits>({
    heightCm: null, heightLabel: null, ageLabel: null, gender: 'unknown',
  });
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [editingStats, setEditingStats] = useState(false);

  const [occasion, setOccasion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittingOccasion, setSubmittingOccasion] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Newest first. Hydrated from DB on mount + prepended to on every
  // successful generate so prior style sheets stay visible in a scroll.
  const [history, setHistory] = useState<StyleGenerationResult[]>([]);
  // image_url → number of Lens results ingested into the catalog from
  // that tile. Surfaced as a small "{n} saved" badge on each tile so
  // the user can spot Style sheets they've already shopped without
  // reopening every one.
  const [ingestCounts, setIngestCounts] = useState<Map<string, number>>(new Map());
  // Lightbox carries the occasion alongside the image so the "Shop
  // this look" CTA can hand both off to the Lens sheet without the
  // page needing to look up the parent generation again.
  const [lightboxOpen, setLightboxOpen] = useState<
    { image: StyleGenerationImage; occasion: string } | null
  >(null);
  const [lensTarget, setLensTarget] = useState<{ imageUrl: string; occasion: string } | null>(null);
  const occasionRef = useRef<HTMLInputElement>(null);

  // Esc closes the lightbox.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxOpen(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxOpen]);

  // Hydrate uploaded photos + saved slot picks (mirrors the Try it on
  // wizard so the same 1–3 reference photos surface here without forcing
  // a re-upload).
  useEffect(() => {
    if (!user?.id) { setUploads([]); setPickedIds([]); return; }
    let cancelled = false;
    Promise.all([
      listUserUploads(user.id),
      getUserSlots(user.id, 3),
    ]).then(([list, slots]) => {
      if (cancelled) return;
      setUploads(list);
      const known = new Set(list.map(u => u.id));
      const ids = slots.filter((id): id is string => typeof id === 'string' && known.has(id));
      setPickedIds(ids);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Hydrate prior style generations + their image rows so the page
  // opens with the user's full history visible.
  useEffect(() => {
    if (!user?.id) { setHistory([]); setIngestCounts(new Map()); return; }
    let cancelled = false;
    listStyleGenerationsWithImages(user.id).then(rows => {
      if (cancelled) return;
      setHistory(rows);
      // Once we have the image URLs, pull the ingest counts in a
      // single batch so each tile can render its "{n} saved" badge.
      const urls = rows.flatMap(r => r.images.map(i => i.image_url).filter((u): u is string => !!u));
      if (urls.length > 0) {
        getLensIngestCounts(urls).then(counts => { if (!cancelled) setIngestCounts(counts); });
      }
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Hydrate profile context (height, age, gender).
  useEffect(() => {
    if (!user?.id) { setProfileHydrated(true); return; }
    let cancelled = false;
    Promise.all([
      getUserHeightAge(user.id),
      supabase.from('profiles').select('gender').eq('id', user.id).maybeSingle(),
    ]).then(([heightAge, profileRow]) => {
      if (cancelled) return;
      const g = (profileRow.data?.gender as string | undefined);
      setProfileBits({
        heightCm: heightAge.heightCm,
        heightLabel: heightAge.heightLabel,
        ageLabel: heightAge.ageLabel,
        gender: (g === 'male' || g === 'female') ? g : 'unknown',
      });
      setProfileHydrated(true);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const pickedUploads = useMemo(
    () => pickedIds.map(id => uploads.find(u => u.id === id)).filter((u): u is UserUpload => !!u),
    [pickedIds, uploads],
  );

  const referenceUrls = useMemo(
    () => pickedUploads.map(u => u.public_url).filter(Boolean),
    [pickedUploads],
  );

  const canSubmit = !!user && referenceUrls.length > 0 && occasion.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !canSubmit) return;
    const trimmed = occasion.trim();
    setSubmitting(true);
    setSubmittingOccasion(trimmed);
    setError(null);
    const { data, error: err } = await createStyleGeneration({
      userId: user.id,
      occasion: trimmed,
      referenceUrls,
    });
    setSubmitting(false);
    setSubmittingOccasion('');
    if (err) { setError(err); return; }
    if (data) {
      setHistory(prev => [data, ...prev.filter(p => p.generation.id !== data.generation.id)]);
      setOccasion('');
    }
  }

  async function handleDeleteImage(generationId: string, imageId: string) {
    if (!user) return;
    // Optimistic per-image remove. If this drops the last image in the
    // sheet, also nuke the parent generation so we don't leave behind
    // an empty header card.
    let parentEmptied = false;
    setHistory(prev => prev.flatMap(entry => {
      if (entry.generation.id !== generationId) return [entry];
      const remaining = entry.images.filter(im => im.id !== imageId);
      if (remaining.length === 0) { parentEmptied = true; return []; }
      return [{ ...entry, images: remaining }];
    }));

    const { error: imgErr } = await deleteStyleGenerationImage(imageId);
    if (imgErr) {
      // Rollback via re-hydrate on RLS / network failure.
      const fresh = await listStyleGenerationsWithImages(user.id);
      setHistory(fresh);
      setError(imgErr);
      return;
    }

    if (parentEmptied) {
      const { error: parentErr } = await deleteStyleGeneration(generationId);
      if (parentErr) {
        const fresh = await listStyleGenerationsWithImages(user.id);
        setHistory(fresh);
        setError(parentErr);
      }
    }
  }

  async function handleToggleLiked(generationId: string, imageId: string, nextLiked: boolean) {
    if (!user) return;
    setHistory(prev => prev.map(entry =>
      entry.generation.id === generationId
        ? {
            ...entry,
            images: entry.images.map(im => im.id === imageId ? { ...im, liked: nextLiked } : im),
          }
        : entry,
    ));
    const { error: err } = await setStyleImageLiked(imageId, nextLiked);
    if (err) {
      const fresh = await listStyleGenerationsWithImages(user.id);
      setHistory(fresh);
      setError(err);
    }
  }

  if (authLoading) {
    return <div className="style-page"><div className="style-loading">Loading…</div></div>;
  }
  if (!user) {
    return (
      <div className="style-page">
        <div className="style-header">
          <button className="style-back" onClick={() => navigate(-1)} aria-label="Back">←</button>
          <h1>Style</h1>
        </div>
        <div className="style-empty">Sign in to use Style.</div>
      </div>
    );
  }

  const noPhotos = profileHydrated && referenceUrls.length === 0;

  return (
    <div className="style-page">
      <div className="style-header">
        <button className="style-back" onClick={() => navigate(-1)} aria-label="Back">←</button>
        <h1>Style</h1>
      </div>

      {/* Shared context strip — photos + height + age, mirroring Try it on. */}
      <section className="style-context">
        <div className="style-context-photos">
          {pickedUploads.length === 0 ? (
            <div className="style-context-empty">No photos yet</div>
          ) : (
            pickedUploads.map(u => (
              <div key={u.id} className="style-context-photo">
                <img src={u.public_url} alt="Reference photo" />
              </div>
            ))
          )}
        </div>
        <div className="style-context-meta">
          {profileBits.heightLabel && <span className="style-context-chip">{profileBits.heightLabel}</span>}
          {profileBits.ageLabel && <span className="style-context-chip">{profileBits.ageLabel}</span>}
          {profileBits.gender !== 'unknown' && (
            <span className="style-context-chip">{profileBits.gender}</span>
          )}
          <button
            type="button"
            className="style-context-edit"
            onClick={() => setEditingStats(true)}
          >
            Edit
          </button>
        </div>
      </section>

      {noPhotos && (
        <div className="style-empty-cta">
          <p>You need at least one reference photo to generate a style sheet.</p>
          <button className="style-primary" onClick={() => navigate('/generate')}>Add photo</button>
        </div>
      )}

      {!noPhotos && (
        <form className="style-form" onSubmit={handleSubmit}>
          <label className="style-question" htmlFor="style-occasion">
            What do you want to be styled for?
          </label>
          <input
            id="style-occasion"
            ref={occasionRef}
            type="text"
            className="style-input"
            placeholder="dates, work, a wedding…"
            value={occasion}
            onChange={e => setOccasion(e.target.value)}
            autoComplete="off"
            disabled={submitting}
          />
          <div className="style-suggestions">
            {OCCASION_SUGGESTIONS.map(s => (
              <button
                key={s}
                type="button"
                className="style-suggestion-chip"
                onClick={() => { setOccasion(s); occasionRef.current?.focus(); }}
                disabled={submitting}
              >
                {s}
              </button>
            ))}
          </div>
          <button type="submit" className="style-primary" disabled={!canSubmit}>
            {submitting ? 'Generating 4 looks…' : 'Generate'}
          </button>
          {error && <div className="style-error">{error}</div>}
        </form>
      )}

      {/* Vertical history of style sheets. While a generation is in flight
          we pin a placeholder card on top with the typed occasion. Each
          card is a 2x2 grid of tiles; tiles open in the lightbox; the
          card has a delete button that cascades the 4 images. */}
      {(submitting || history.length > 0) && (
        <section className="style-history">
          {submitting && (
            <StyleSheetCard
              title={submittingOccasion || 'Generating…'}
              subtitle="Generating 4 looks…"
              images={null}
              onOpen={(img) => setLightboxOpen({ image: img, occasion: submittingOccasion })}
            />
          )}
          {history.map(entry => (
            <StyleSheetCard
              key={entry.generation.id}
              title={entry.generation.occasion}
              subtitle={new Date(entry.generation.created_at).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
              images={entry.images}
              onOpen={(img) => setLightboxOpen({ image: img, occasion: entry.generation.occasion })}
              onDeleteImage={imageId => handleDeleteImage(entry.generation.id, imageId)}
              onToggleLiked={(imageId, nextLiked) => handleToggleLiked(entry.generation.id, imageId, nextLiked)}
              ingestCounts={ingestCounts}
            />
          ))}
        </section>
      )}

      {lightboxOpen && lightboxOpen.image.image_url && (
        <StyleLightbox
          image={lightboxOpen.image}
          onClose={() => setLightboxOpen(null)}
          onShop={() => {
            // Hand off both image + occasion to the lens sheet, then
            // close the lightbox so the two overlays don't stack.
            setLensTarget({
              imageUrl: lightboxOpen.image.image_url ?? '',
              occasion: lightboxOpen.occasion,
            });
            setLightboxOpen(null);
          }}
        />
      )}

      {lensTarget && (
        <Suspense fallback={null}>
          <StyleLensSheet
            imageUrl={lensTarget.imageUrl}
            occasion={lensTarget.occasion}
            onClose={() => setLensTarget(null)}
          />
        </Suspense>
      )}

      {editingStats && user && (
        <StatsEditorModal
          userId={user.id}
          initial={profileBits}
          onClose={() => setEditingStats(false)}
          onSaved={(next) => {
            setProfileBits(next);
            setEditingStats(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * One style sheet (4-tile grid) with header + delete. `images=null`
 * renders 4 loading placeholders for the in-flight generation pinned
 * on top.
 */
function StyleSheetCard({
  title,
  subtitle,
  images,
  onOpen,
  onDeleteImage,
  onToggleLiked,
  ingestCounts,
}: {
  title: string;
  subtitle: string;
  images: StyleGenerationImage[] | null;
  onOpen: (img: StyleGenerationImage) => void;
  onDeleteImage?: (imageId: string) => void;
  onToggleLiked?: (imageId: string, nextLiked: boolean) => void;
  ingestCounts?: Map<string, number>;
}) {
  // While generating (images === null) we show 4 placeholders so the
  // card has visible weight; otherwise we render exactly the rows the
  // user still has — per-image delete just removes its slot, and once
  // every slot is gone the parent page nukes the empty card too.
  const slots: (StyleGenerationImage | null)[] = images
    ? [...images].sort((a, b) => a.sort_order - b.sort_order)
    : Array.from({ length: 4 }, () => null);

  return (
    <article className="style-sheet">
      <div className="style-sheet-header">
        <div className="style-sheet-meta">
          <h3 className="style-sheet-title">{title}</h3>
          <span className="style-sheet-subtitle">{subtitle}</span>
        </div>
      </div>
      <div className="style-grid">
        {slots.map((img, i) => (
          <StyleResultTile
            key={img?.id ?? i}
            image={img}
            index={i}
            onOpen={onOpen}
            onDelete={img && onDeleteImage ? () => onDeleteImage(img.id) : null}
            onToggleLiked={img && onToggleLiked ? (next) => onToggleLiked(img.id, next) : null}
            ingestCount={img?.image_url ? ingestCounts?.get(img.image_url) ?? 0 : 0}
          />
        ))}
      </div>
    </article>
  );
}

function StyleLightbox({
  image,
  onClose,
  onShop,
}: {
  image: StyleGenerationImage;
  onClose: () => void;
  onShop: () => void;
}) {
  // Click-to-zoom (1x ↔ 2x) with pointer drag-pan when zoomed. We
  // track translate(x, y) in state and apply via transform so a
  // single CSS transition handles both axes cleanly. Pointer events
  // unify mouse + touch so the same code path works on phones.
  const [zoomed, setZoomed] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // `panning` toggles the CSS transition off during drag-pan so
  // moves are 1:1 with the cursor; the transition still fires on
  // zoom-in / zoom-out toggles. Only flips at the start/end of a
  // drag, not per pointer-move.
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const onImgClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    e.stopPropagation();
    // Only honor click-to-zoom if it isn't the tail end of a drag.
    if (dragRef.current) return;
    // Capture the rect + click coords NOW, before the setZoomed updater
    // runs — React's synthetic event pool nulls e.currentTarget after
    // the handler returns, so reading rect inside the updater throws
    // TypeError (the production "Application Error" on tile click).
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    setZoomed(z => {
      if (z) { setPan({ x: 0, y: 0 }); return false; }
      // Center the click point so the area the user tapped grows
      // out from under their finger / cursor instead of jumping
      // to a corner.
      setPan({ x: -cx, y: -cy });
      return true;
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (!zoomed) return;
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [zoomed, pan.x, pan.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    setPan({
      x: dragRef.current.baseX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.baseY + (e.clientY - dragRef.current.startY),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    const wasDragging = dragRef.current !== null;
    dragRef.current = null;
    setPanning(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    // Suppress the synthesized click that fires after a drag-pan
    // (otherwise releasing the pan toggles the zoom back to 1x).
    if (wasDragging) e.stopPropagation();
  }, []);

  // Click anywhere on the dim backdrop closes; clicks on the image
  // itself are handled above. Stop propagation on the frame so a
  // tap on the wordmark area doesn't dismiss.
  return (
    <div className="style-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button className="style-lightbox-close" onClick={onClose} aria-label="Close">×</button>
      <div className="style-lightbox-frame" onClick={e => e.stopPropagation()}>
        <img
          className={`style-lightbox-img${zoomed ? ' is-zoomed' : ''}`}
          src={image.image_url ?? ''}
          alt={`Style reference (${image.provider})`}
          decoding="async"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomed ? 2 : 1})`,
            transition: panning ? 'none' : undefined,
          }}
          onClick={onImgClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          draggable={false}
        />
        <span className="style-lightbox-wordmark" aria-hidden="true">Catalog</span>
        {/* Shop CTA — stopPropagation on click so it doesn't bubble up
            into the zoom handler beneath. Opens the Lens sheet which
            takes over the viewport with shoppable matches + try-on. */}
        <button
          type="button"
          className="style-lightbox-shop"
          onClick={(e) => { e.stopPropagation(); onShop(); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Shop this look
        </button>
      </div>
    </div>
  );
}

function StyleResultTile({
  image,
  index,
  onOpen,
  onDelete,
  onToggleLiked,
  ingestCount,
  showProviderBadge,
}: {
  image: StyleGenerationImage | null;
  index: number;
  onOpen: (img: StyleGenerationImage) => void;
  onDelete?: (() => void) | null;
  onToggleLiked?: ((nextLiked: boolean) => void) | null;
  ingestCount?: number;
  // Super-admin only — shows which image-gen provider (gpt-image-1 or
  // nano-banana-2) produced each tile, so engineering can spot quality
  // regressions per model at a glance without diving into the
  // /admin/user.$name diagnostic page.
  showProviderBadge?: boolean;
}) {
  if (!image) {
    return (
      <div className="style-tile is-loading" aria-label={`Generating image ${index + 1}`}>
        <div className="style-tile-spinner" />
      </div>
    );
  }
  // Heart (top-left) + trash (top-right). stopPropagation on each so
  // the click doesn't bubble into the tile-open button beneath.
  const heartBtn = onToggleLiked ? (
    <button
      type="button"
      className={`style-tile-like ${image.liked ? 'is-liked' : ''}`}
      onClick={e => { e.stopPropagation(); onToggleLiked(!image.liked); }}
      aria-label={image.liked ? `Unlike image ${index + 1}` : `Like image ${index + 1}`}
      aria-pressed={image.liked}
      title={image.liked ? 'Unlike' : 'Like'}
    >
      <svg width="16" height="16" viewBox="0 0 24 24"
        fill={image.liked ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </button>
  ) : null;

  const deleteBtn = onDelete ? (
    <button
      type="button"
      className="style-tile-delete"
      onClick={e => { e.stopPropagation(); onDelete(); }}
      aria-label={`Delete image ${index + 1}`}
      title="Delete"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  ) : null;

  if (image.status === 'done' && image.image_url) {
    return (
      <div className="style-tile is-done">
        <button
          type="button"
          className="style-tile-open"
          onClick={() => onOpen(image)}
          aria-label={`Open style reference ${index + 1}`}
        >
          {/* loading=lazy + decoding=async + intrinsic size hint so the
              browser allocates pixels without forcing layout, defers
              off-screen tiles, and decodes off the main thread. */}
          <img
            src={image.image_url}
            alt={`Style reference ${index + 1}`}
            loading="lazy"
            decoding="async"
            width={1280}
            height={720}
          />
        </button>
        {/* Provider badge intentionally omitted on the user end — the
            admin user/$name page still surfaces it for debugging. */}

        {heartBtn}
        {deleteBtn}
        {ingestCount && ingestCount > 0 ? (
          <span className="style-tile-ingest" aria-label={`${ingestCount} items saved from this look`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {ingestCount} saved
          </span>
        ) : null}
      </div>
    );
  }
  // Pending rows on a hydrated history (e.g. user reloaded mid-run, or the
  // edge function timed out before settling) keep the spinner — only
  // explicit `failed` rows render the error chrome.
  if (image.status === 'pending') {
    return (
      <div className="style-tile is-loading" aria-label={`Generating image ${index + 1}`}>
        <span className="style-tile-badge">{image.provider}</span>
        <div className="style-tile-spinner" />
      </div>
    );
  }
  return (
    <div className="style-tile is-failed">
      <div className="style-tile-error">{image.error ?? 'Failed'}</div>
      {deleteBtn}
    </div>
  );
}

/**
 * Inline editor for the user's "stats" — height, age, gender. Persists
 * to `profiles` via `updateUserHeightAge` + `updateUserGender`. Replaces
 * the old flow that bounced to /generate just to edit a chip.
 */
function StatsEditorModal({
  userId,
  initial,
  onClose,
  onSaved,
}: {
  userId: string;
  initial: ProfileBadgeBits;
  onClose: () => void;
  onSaved: (next: ProfileBadgeBits) => void;
}) {
  // Resolve the height dropdown's selection from the saved cm value
  // when present, otherwise fall back to a label match so users who
  // only have the label persisted still land on the right row.
  const initialHeight = useMemo(() => {
    if (initial.heightCm) {
      const byCm = HEIGHT_OPTIONS.find(h => h.cm === initial.heightCm);
      if (byCm) return byCm;
    }
    if (initial.heightLabel) {
      const byLabel = HEIGHT_OPTIONS.find(h => h.label === initial.heightLabel);
      if (byLabel) return byLabel;
    }
    return HEIGHT_OPTIONS.find(h => h.label === "5'10\"") ?? HEIGHT_OPTIONS[0];
  }, [initial.heightCm, initial.heightLabel]);

  const [heightCm, setHeightCm] = useState<number>(initialHeight.cm);
  const [heightLabel, setHeightLabel] = useState<string>(initialHeight.label);
  const [ageLabel, setAgeLabel] = useState<string>(initial.ageLabel ?? 'mid 20s');
  const [gender, setGender] = useState<UserGender>(initial.gender);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc closes the modal so it follows the same dismiss pattern as the
  // lightbox. Click on the backdrop also closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    // Persist both writes in parallel — gender lives on a sibling
    // service so we run them concurrently and surface whichever
    // error fires first.
    const [heightResult, genderResult] = await Promise.all([
      updateUserHeightAge(userId, { heightCm, heightLabel, ageLabel }),
      updateUserGender(userId, gender),
    ]);
    setSaving(false);
    if (heightResult.error) { setError(heightResult.error); return; }
    if (genderResult.error) { setError(genderResult.error); return; }
    onSaved({ heightCm, heightLabel, ageLabel, gender });
  }

  return (
    <div className="style-stats-modal" onClick={onClose} role="dialog" aria-modal="true">
      <div className="style-stats-card" onClick={e => e.stopPropagation()}>
        <div className="style-stats-header">
          <h2>Your stats</h2>
          <button
            type="button"
            className="style-stats-close"
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </div>
        <p className="style-stats-hint">
          These get used in every generated look so the model matches your build.
        </p>

        <label className="style-stats-field">
          <span className="style-stats-label">Height</span>
          <select
            value={heightCm}
            onChange={e => {
              const cm = Number(e.target.value);
              const opt = HEIGHT_OPTIONS.find(h => h.cm === cm);
              if (!opt) return;
              setHeightCm(opt.cm);
              setHeightLabel(opt.label);
            }}
            disabled={saving}
          >
            {HEIGHT_OPTIONS.map(h => (
              <option key={h.cm} value={h.cm}>{h.label}</option>
            ))}
          </select>
        </label>

        <label className="style-stats-field">
          <span className="style-stats-label">Age</span>
          <select
            value={ageLabel}
            onChange={e => setAgeLabel(e.target.value)}
            disabled={saving}
          >
            {AGE_OPTIONS.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>

        <fieldset className="style-stats-field">
          <span className="style-stats-label">Gender</span>
          <div className="style-stats-gender">
            {(['male', 'female', 'unknown'] as const).map(g => (
              <label key={g} className={`style-stats-gender-opt${gender === g ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="style-stats-gender"
                  value={g}
                  checked={gender === g}
                  onChange={() => setGender(g)}
                  disabled={saving}
                />
                <span>{g === 'unknown' ? 'Prefer not to say' : g}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <div className="style-error">{error}</div>}

        <div className="style-stats-actions">
          <button
            type="button"
            className="style-stats-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="style-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

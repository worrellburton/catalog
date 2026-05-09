import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import '~/styles/style-page.css';
import { useAuth } from '~/hooks/useAuth';
import { listUserUploads, getUserSlots, type UserUpload } from '~/services/user-generations';
import { getUserHeightAge } from '~/services/profiles';
import { supabase } from '~/utils/supabase';
import {
  createStyleGeneration,
  listStyleGenerationsWithImages,
  deleteStyleGeneration,
  deleteStyleGenerationImage,
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
  heightLabel: string | null;
  ageLabel: string | null;
  gender: 'male' | 'female' | 'unknown';
}

export default function StylePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [uploads, setUploads] = useState<UserUpload[]>([]);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [profileBits, setProfileBits] = useState<ProfileBadgeBits>({
    heightLabel: null, ageLabel: null, gender: 'unknown',
  });
  const [profileHydrated, setProfileHydrated] = useState(false);

  const [occasion, setOccasion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittingOccasion, setSubmittingOccasion] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Newest first. Hydrated from DB on mount + prepended to on every
  // successful generate so prior style sheets stay visible in a scroll.
  const [history, setHistory] = useState<StyleGenerationResult[]>([]);
  const [lightboxImage, setLightboxImage] = useState<StyleGenerationImage | null>(null);
  const occasionRef = useRef<HTMLInputElement>(null);

  // Esc closes the lightbox.
  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxImage(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxImage]);

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
    if (!user?.id) { setHistory([]); return; }
    let cancelled = false;
    listStyleGenerationsWithImages(user.id).then(rows => {
      if (cancelled) return;
      setHistory(rows);
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

  async function handleDelete(generationId: string) {
    if (!user) return;
    // Optimistic remove — RLS confirms ownership server-side and ON DELETE
    // CASCADE removes the 4 image rows. If the call fails we re-hydrate.
    setHistory(prev => prev.filter(p => p.generation.id !== generationId));
    const { error: err } = await deleteStyleGeneration(generationId);
    if (err && user.id) {
      const fresh = await listStyleGenerationsWithImages(user.id);
      setHistory(fresh);
      setError(err);
    }
  }

  async function handleDeleteImage(generationId: string, imageId: string) {
    if (!user) return;
    // Optimistic per-image remove. Drops the image from the parent
    // sheet's images array; rolls back via re-hydrate on RLS failure.
    setHistory(prev => prev.map(entry =>
      entry.generation.id === generationId
        ? { ...entry, images: entry.images.filter(im => im.id !== imageId) }
        : entry,
    ));
    const { error: err } = await deleteStyleGenerationImage(imageId);
    if (err && user.id) {
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
        <header className="style-header">
          <button className="style-back" onClick={() => navigate(-1)} aria-label="Back">←</button>
          <h1>Style</h1>
        </header>
        <div className="style-empty">Sign in to use Style.</div>
      </div>
    );
  }

  const noPhotos = profileHydrated && referenceUrls.length === 0;

  return (
    <div className="style-page">
      <header className="style-header">
        <button className="style-back" onClick={() => navigate(-1)} aria-label="Back">←</button>
        <h1>Style</h1>
      </header>

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
            onClick={() => navigate('/generate')}
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
              onOpen={setLightboxImage}
              onDelete={null}
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
              onOpen={setLightboxImage}
              onDelete={() => handleDelete(entry.generation.id)}
              onDeleteImage={imageId => handleDeleteImage(entry.generation.id, imageId)}
            />
          ))}
        </section>
      )}

      {lightboxImage && lightboxImage.image_url && (
        <StyleLightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />
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
  onDelete,
  onDeleteImage,
}: {
  title: string;
  subtitle: string;
  images: StyleGenerationImage[] | null;
  onOpen: (img: StyleGenerationImage) => void;
  onDelete: (() => void) | null;
  onDeleteImage?: (imageId: string) => void;
}) {
  // While generating (images === null) we show 4 placeholders so the
  // card has visible weight; otherwise we render exactly the rows the
  // user still has — per-image delete just removes its slot.
  const slots: (StyleGenerationImage | null)[] = images
    ? [...images].sort((a, b) => a.sort_order - b.sort_order)
    : Array.from({ length: 4 }, () => null);

  return (
    <article className="style-sheet">
      <header className="style-sheet-header">
        <div className="style-sheet-meta">
          <h3 className="style-sheet-title">{title}</h3>
          <span className="style-sheet-subtitle">{subtitle}</span>
        </div>
        {onDelete && (
          <button
            type="button"
            className="style-sheet-delete"
            onClick={onDelete}
            aria-label="Delete this style sheet"
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
        )}
      </header>
      <div className="style-grid">
        {slots.map((img, i) => (
          <StyleResultTile
            key={img?.id ?? i}
            image={img}
            index={i}
            onOpen={onOpen}
            onDelete={img && onDeleteImage ? () => onDeleteImage(img.id) : null}
          />
        ))}
      </div>
    </article>
  );
}

function StyleLightbox({ image, onClose }: { image: StyleGenerationImage; onClose: () => void }) {
  // Click anywhere on the dim backdrop closes; clicks on the image
  // itself stop propagation so the user can interact with it without
  // triggering an accidental dismiss.
  return (
    <div className="style-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button className="style-lightbox-close" onClick={onClose} aria-label="Close">×</button>
      <img
        className="style-lightbox-img"
        src={image.image_url ?? ''}
        alt={`Style reference (${image.provider})`}
        onClick={e => e.stopPropagation()}
      />
      <span className="style-lightbox-badge">{image.provider}</span>
    </div>
  );
}

function StyleResultTile({
  image,
  index,
  onOpen,
  onDelete,
}: {
  image: StyleGenerationImage | null;
  index: number;
  onOpen: (img: StyleGenerationImage) => void;
  onDelete?: (() => void) | null;
}) {
  if (!image) {
    return (
      <div className="style-tile is-loading" aria-label={`Generating image ${index + 1}`}>
        <div className="style-tile-spinner" />
      </div>
    );
  }
  // Reusable per-tile X. stopPropagation so it doesn't fire the
  // tile's lightbox-open click. Visible on hover (desktop) and always
  // (mobile) via CSS.
  const deleteBtn = onDelete ? (
    <button
      type="button"
      className="style-tile-delete"
      onClick={e => { e.stopPropagation(); onDelete(); }}
      aria-label={`Delete image ${index + 1}`}
      title="Delete"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
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
          <img src={image.image_url} alt={`Style reference ${index + 1}`} />
        </button>
        <span className="style-tile-badge">{image.provider}</span>
        {deleteBtn}
      </div>
    );
  }
  return (
    <div className="style-tile is-failed">
      <span className="style-tile-badge">{image.provider}</span>
      <div className="style-tile-error">{image.error ?? 'Failed'}</div>
      {deleteBtn}
    </div>
  );
}

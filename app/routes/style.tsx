import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import '~/styles/style-page.css';
import { useAuth } from '~/hooks/useAuth';
import { listUserUploads, getUserSlots, type UserUpload } from '~/services/user-generations';
import { getUserHeightAge } from '~/services/profiles';
import { supabase } from '~/utils/supabase';
import {
  createStyleGeneration,
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
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StyleGenerationResult | null>(null);
  const occasionRef = useRef<HTMLInputElement>(null);

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
    setSubmitting(true);
    setError(null);
    setResult(null);
    const { data, error: err } = await createStyleGeneration({
      userId: user.id,
      occasion: occasion.trim(),
      referenceUrls,
    });
    setSubmitting(false);
    if (err) { setError(err); return; }
    setResult(data);
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

      {/* Result grid. While submitting we show 4 placeholder tiles so the
          intent is obvious. After the response lands we show whichever of
          the 4 image slots came back successfully; failed tiles show the
          provider error inline so the user can retry. */}
      {(submitting || result) && (
        <section className="style-results">
          <h2 className="style-results-title">
            {submitting ? 'Generating…' : 'Your style sheet'}
          </h2>
          <div className="style-grid">
            {(submitting ? Array.from({ length: 4 }).map((_, i) => null) : result?.images ?? [])
              .map((img, i) => <StyleResultTile key={(img as StyleGenerationImage)?.id ?? i} image={img as StyleGenerationImage | null} index={i} />)
            }
          </div>
        </section>
      )}
    </div>
  );
}

function StyleResultTile({ image, index }: { image: StyleGenerationImage | null; index: number }) {
  if (!image) {
    return (
      <div className="style-tile is-loading" aria-label={`Generating image ${index + 1}`}>
        <div className="style-tile-spinner" />
      </div>
    );
  }
  if (image.status === 'done' && image.image_url) {
    return (
      <div className="style-tile is-done">
        <img src={image.image_url} alt={`Style reference ${index + 1}`} />
        <span className="style-tile-badge">{image.provider}</span>
      </div>
    );
  }
  return (
    <div className="style-tile is-failed">
      <span className="style-tile-badge">{image.provider}</span>
      <div className="style-tile-error">{image.error ?? 'Failed'}</div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { listUserGenerations, isGenerationInFlight, getGenerationDetail } from '~/services/user-generations';
import { useAuth } from '~/hooks/useAuth';

/**
 * Header indicator that surfaces when the signed-in user has a look
 * still rendering after they've left the /generate screen via "Keep
 * discovering". Tapping the pill returns to /generate so they can
 * watch progress or run another action against the in-flight job.
 *
 * Shows the look's face photos + chosen products orbiting in a small 3D
 * ring (mirrors the full "Vision composes…" screen). Only visible at the
 * very top of the feed — it hides once the shopper scrolls into the grid.
 * Polls listUserGenerations every 6s while at least one row is unfinished.
 */
export default function PendingLookPill({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth();
  const [pending, setPending] = useState<{ id: string; status: string; style: string | null } | null>(null);
  const [images, setImages] = useState<string[]>([]);
  // Only surface the pill at the very top of the feed — once the shopper
  // scrolls into the grid it shouldn't keep hovering over the content.
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!user) { setPending(null); return; }
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      const rows = await listUserGenerations(user.id);
      if (cancelled) return;
      // Only count rows that are genuinely still rendering — a zombie
      // 'pending' row the pipeline never reconciled is excluded by the
      // staleness cutoff so the pill doesn't haunt the header forever.
      const inFlight = rows.find(isGenerationInFlight);
      setPending(inFlight ? { id: inFlight.id, status: inFlight.status, style: inFlight.style ?? null } : null);
      if (inFlight) {
        timer = window.setTimeout(tick, 6000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [user]);

  // Pull the in-flight look's face photos + products so they can orbit in
  // the pill. Refetched whenever the in-flight generation changes; capped so
  // the tiny ring never gets too busy.
  useEffect(() => {
    if (!pending?.id) { setImages([]); return; }
    let cancelled = false;
    getGenerationDetail(pending.id).then((d) => {
      if (cancelled) return;
      const faces = d.uploads.map((u) => u.public_url).filter((u): u is string => !!u);
      const products = d.products.map((p) => p.product?.image_url).filter((u): u is string => !!u);
      setImages([...faces, ...products].slice(0, 6));
    }).catch(() => { /* keep the spinner fallback */ });
    return () => { cancelled = true; };
  }, [pending?.id]);

  if (!pending || !atTop) return null;
  const label = pending.style ? `Your ${pending.style.toLowerCase()} look is rendering` : 'Your look is rendering';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pending-look-pill"
      aria-label={label}
      title={label}
    >
      {images.length > 0 ? (
        <span className="pending-look-pill-orbit" aria-hidden="true">
          <span className="pending-look-pill-orbit-ring" style={{ ['--n' as string]: images.length }}>
            {images.map((src, i) => (
              <span key={`${src}-${i}`} className="pending-look-pill-orbit-item" style={{ ['--i' as string]: i }}>
                <img src={src} alt="" loading="lazy" decoding="async" />
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span className="pending-look-pill-spinner" aria-hidden="true" />
      )}
      <span className="pending-look-pill-label">{label}</span>
    </button>
  );
}

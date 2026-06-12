import { useEffect, useState } from 'react';
import { listUserGenerations, isGenerationInFlight, getGenerationDetail } from '~/services/user-generations';
import { useAuth } from '~/hooks/useAuth';

// Rotating, tongue-in-cheek status lines shown while a look is cooking — a
// playful stand-in for the dry word "rendering". Cycles every few seconds so
// the pill feels alive instead of stuck.
const PENDING_QUIPS = [
  'Steaming the pixels…',
  'Teaching the fabric to drape…',
  'Auditioning camera angles…',
  'Convincing the shoes to behave…',
  'Negotiating with the lighting…',
  'Adding main-character energy…',
  'Whispering to the color grade…',
  'Picking the perfect pose…',
  'Stitching the look together…',
  'Consulting the style oracle…',
  'Removing the awkward blink…',
  'Steaming out the wrinkles…',
];

/**
 * Header indicator that surfaces when the signed-in user has a look
 * still rendering after they've left the /generate screen via "Keep
 * discovering". Tapping the pill opens the rendering page for THAT
 * look (/generate?gen=<id> resumes its progress screen directly).
 *
 * Shows the look's face photos + chosen products orbiting in a small 3D
 * ring (mirrors the full "Vision composes…" screen). Only visible at the
 * very top of the feed — it hides once the shopper scrolls into the grid.
 * Polls listUserGenerations every 6s while at least one row is unfinished.
 */
export default function PendingLookPill({ onOpen }: { onOpen: (generationId?: string) => void }) {
  const { user } = useAuth();
  const [pending, setPending] = useState<{ id: string; status: string; style: string | null } | null>(null);
  const [images, setImages] = useState<string[]>([]);
  // Only surface the pill at the very top of the feed — once the shopper
  // scrolls into the grid it shouldn't keep hovering over the content.
  const [atTop, setAtTop] = useState(true);
  // Index into PENDING_QUIPS — advances on a timer so the pill rotates
  // through the humorous status lines while a look is in flight.
  const [quipIdx, setQuipIdx] = useState(() => Math.floor(Math.random() * PENDING_QUIPS.length));
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

  const showing = !!pending && atTop;
  // Flag the app while the pill is on screen so the mobile creator stories
  // row can drop below it (with equal spacing) instead of overlapping —
  // and slide back up when the pill goes away. CSS keys off this class.
  useEffect(() => {
    const cls = 'has-pending-look';
    if (showing) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [showing]);
  // Rotate the quip every ~2.8s while the pill is actually on screen.
  useEffect(() => {
    if (!showing) return;
    const t = window.setInterval(() => {
      setQuipIdx(i => (i + 1) % PENDING_QUIPS.length);
    }, 2800);
    return () => window.clearInterval(t);
  }, [showing]);

  if (!showing) return null;
  const quip = PENDING_QUIPS[quipIdx];
  const ariaLabel = 'Your look is on the way — tap to watch it come together';
  return (
    <button
      type="button"
      onClick={() => onOpen(pending?.id)}
      className="pending-look-pill"
      aria-label={ariaLabel}
      title={ariaLabel}
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
      <span key={quipIdx} className="pending-look-pill-label pending-look-pill-label--quip">{quip}</span>
    </button>
  );
}

// AddProductV2 — guided "add a product to your catalog" flow.
//
// Mirrors the Create-a-Look hero pattern: particle backdrop, a small
// glassy card that springs in, faded prompt copy underneath. From the
// empty state the user can do one of two things:
//
//   1. Paste a URL → we hand it to the existing scrape-product
//      pipeline (addProductUrl + Modal scraper trigger), show a
//      progress bar that counts the typical scrape window, and tell
//      the user the work is happening in the background so they can
//      keep shopping.
//
//   2. Type a description ("cream linen camp shirt") → we run a live
//      Google Shopping search via product-search and show the first
//      result with "Is this it?" Yes/No. Yes → drop the resolved
//      product URL into the scrape pipeline (same path as #1). No →
//      let the user refine and try again.
//
// The shape is intentionally one-screen-per-thought so the user
// always knows what to do next.

import { useCallback, useEffect, useRef, useState } from 'react';
import ParticleBackground from './ParticleBackground';
import { addProductUrl } from '~/services/scrape-product';
import { researchProducts, type ResearchedProduct } from '~/services/product-research';

interface Props {
  onCancel: () => void;
  /** Fires once a product has been queued (URL submitted or candidate
   *  confirmed). The host (MyLooks) can refresh its list or surface a
   *  confirmation toast. */
  onQueued?: (info: { url: string; productId: string }) => void;
}

type Phase =
  | 'empty'        // initial: input + Go
  | 'searching'    // description path: live Shopping search running
  | 'confirm'      // description path: show candidate, ask "Is this it?"
  | 'queuing'      // about to insert row + trigger scrape
  | 'progress'     // row inserted, scrape ticking in background
  | 'done';        // progress bar reached "go shop more" state

// Rough wall-clock for a Modal scrape end-to-end. The bar shows this
// as the countdown; the actual ingest can be faster (cache hits) or
// slower (cold start). Either way the user is told it's happening in
// the background so they don't have to wait on this screen.
const EXPECTED_SCRAPE_MS = 18_000;

function looksLikeUrl(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  // Bare domains like "aloyoga.com/products/xyz".
  return /^[a-z0-9-]+\.[a-z]{2,}\/.+/i.test(trimmed);
}

function normalizeUrl(s: string): string {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export default function AddProductV2({ onCancel, onQueued }: Props) {
  const [phase, setPhase] = useState<Phase>('empty');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ResearchedProduct | null>(null);
  const [progress, setProgress] = useState(0);
  const [queuedUrl, setQueuedUrl] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track the soft-keyboard height on mobile via visualViewport so the
  // hero re-centers in the SHRUNKEN viewport when the keyboard opens.
  // Without this the input slides under the keyboard the moment the
  // user taps it. We write the height to a CSS variable that the
  // .apv2-hero rule reads (--apv2-kb).
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const root = rootRef.current;
    if (!root) return;
    const sync = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--apv2-kb', `${Math.round(kb)}px`);
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);
  const tickerRef = useRef<number | null>(null);

  // Spring the page in on first frame so the hero card animation hits.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Tick a progress bar from 0 → 100 across the expected scrape window.
  // We start it when we enter 'progress'. It's purely visual — the
  // actual ingest runs on Modal in the background and the user is
  // free to leave the screen at any time.
  useEffect(() => {
    if (phase !== 'progress') return;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const ratio = Math.min(1, elapsed / EXPECTED_SCRAPE_MS);
      setProgress(ratio * 100);
      if (ratio < 1) {
        tickerRef.current = window.requestAnimationFrame(tick);
      } else {
        setPhase('done');
      }
    };
    tickerRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (tickerRef.current != null) window.cancelAnimationFrame(tickerRef.current);
    };
  }, [phase]);

  const queueFromUrl = useCallback(async (rawUrl: string) => {
    setPhase('queuing');
    setError(null);
    try {
      const url = normalizeUrl(rawUrl);
      const row = await addProductUrl(url);
      setQueuedUrl(url);
      onQueued?.({ url, productId: row.id });
      setPhase('progress');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add product');
      setPhase('empty');
    }
  }, [onQueued]);

  const handleGo = useCallback(async () => {
    const v = input.trim();
    if (!v) return;
    setError(null);
    if (looksLikeUrl(v)) {
      void queueFromUrl(v);
      return;
    }
    // Description path: search Google Shopping for a likely candidate
    // and show "Is this it?".
    setPhase('searching');
    try {
      const res = await researchProducts(v, { liveOnly: true });
      const top = res.products[0] || null;
      if (!top || !top.url) {
        setError(res.error || `Couldn't find that. Try adding a brand, or paste a link.`);
        setPhase('empty');
        return;
      }
      setCandidate(top);
      setPhase('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setPhase('empty');
    }
  }, [input, queueFromUrl]);

  const confirmCandidate = useCallback(() => {
    if (!candidate?.url) return;
    void queueFromUrl(candidate.url);
  }, [candidate, queueFromUrl]);

  const rejectCandidate = useCallback(() => {
    setCandidate(null);
    setPhase('empty');
  }, []);

  return (
    <div ref={rootRef} className={`apv2${mounted ? ' is-mounted' : ''}`}>
      {/* Particle field — same backdrop as Create a Look. */}
      <div className="apv2-particles" aria-hidden="true">
        <ParticleBackground />
      </div>

      <header className="apv2-head">
        <h2>Add a product</h2>
        <button type="button" className="apv2-close" onClick={onCancel} aria-label="Cancel">×</button>
      </header>

      {/* Empty state — the hero card + faded prompt. */}
      {phase === 'empty' && (
        <div className="apv2-hero">
          <div className="apv2-hero-card">
            <span className="apv2-hero-icon" aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
            </span>
          </div>
          <span className="apv2-hero-label">Tell me the product or paste a link.</span>
          <div className="apv2-input-row">
            <input
              ref={inputRef}
              type="text"
              className="apv2-input"
              placeholder="e.g. cream linen camp shirt — or https://…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleGo(); } }}
              onFocus={() => {
                // Belt-and-suspenders for browsers without visualViewport
                // (or where the timing of the variable update lags). Wait
                // a frame past the keyboard's open animation, then bring
                // the input into the center of whatever is visible.
                window.setTimeout(() => {
                  inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }, 250);
              }}
              autoFocus
            />
            <button
              type="button"
              className="apv2-go"
              onClick={() => void handleGo()}
              disabled={!input.trim()}
            >
              Go
            </button>
          </div>
          {error && <span className="apv2-error">{error}</span>}
        </div>
      )}

      {/* Description path: searching */}
      {phase === 'searching' && (
        <div className="apv2-status">
          <span className="apv2-spinner" aria-hidden />
          <span>Searching for that product…</span>
        </div>
      )}

      {/* Description path: confirm */}
      {phase === 'confirm' && candidate && (
        <div className="apv2-confirm">
          <span className="apv2-confirm-q">Is this it?</span>
          <div className="apv2-confirm-card">
            {candidate.image_url
              ? <img src={candidate.image_url} alt={candidate.name} />
              : <div className="apv2-confirm-card-blank" aria-hidden />
            }
            <div className="apv2-confirm-meta">
              {candidate.brand && <span className="apv2-confirm-brand">{candidate.brand}</span>}
              <span className="apv2-confirm-name">{candidate.name}</span>
              {candidate.price && <span className="apv2-confirm-price">{candidate.price}</span>}
            </div>
          </div>
          <div className="apv2-confirm-row">
            <button type="button" className="apv2-btn-secondary" onClick={rejectCandidate}>No, try again</button>
            <button type="button" className="apv2-btn-primary" onClick={confirmCandidate}>Yes, add it</button>
          </div>
        </div>
      )}

      {/* Link path / post-confirm: queuing the row + triggering scrape */}
      {phase === 'queuing' && (
        <div className="apv2-status">
          <span className="apv2-spinner" aria-hidden />
          <span>Sending to the scraper…</span>
        </div>
      )}

      {/* Progress + "you can leave" hint */}
      {(phase === 'progress' || phase === 'done') && (
        <div className="apv2-progress">
          <div className="apv2-progress-bar">
            <div className="apv2-progress-fill" style={{ width: `${Math.max(progress, phase === 'done' ? 100 : progress)}%` }} />
          </div>
          <span className="apv2-progress-label">
            {phase === 'done'
              ? 'Almost done — adding in the background.'
              : `Importing… about ${Math.max(1, Math.round((EXPECTED_SCRAPE_MS - (progress / 100) * EXPECTED_SCRAPE_MS) / 1000))}s left`}
          </span>
          {queuedUrl && (
            <span className="apv2-progress-url" title={queuedUrl}>{queuedUrl}</span>
          )}
          <span className="apv2-progress-hint">
            You can keep shopping — we'll finish adding this one in the background.
          </span>
          <div className="apv2-progress-actions">
            <button type="button" className="apv2-btn-secondary" onClick={() => { setInput(''); setProgress(0); setQueuedUrl(null); setCandidate(null); setPhase('empty'); }}>
              Add another
            </button>
            <button type="button" className="apv2-btn-primary" onClick={onCancel}>
              Keep shopping
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

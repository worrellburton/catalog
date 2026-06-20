// CreatorConstellation — the "people & brands" page parked in the viewport
// ABOVE the home feed. You scroll up into it (pull down at the very top) and
// it snaps into place; the same profile circles from the top arc gather into a
// readable orbit of the creators you follow plus the brands you save, each
// with a glanceable insight. The vertical slide/snap is owned by a CSS var
// (--people-pull, see utils/peoplePanel) so the pull tracks your finger; this
// component owns the look + the spring stagger of the tiles on open.
//
// Data is resilient + client-only:
//   • Creators — who you follow (newest-posting first); featured creators of
//     your gender when you follow no one yet.
//   • Brands — derived from the products you've saved (your strongest "I like
//     this brand" signal); hidden until you've saved something.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { supabase } from '~/utils/supabase';
import { getMyFollowing, getPopularCreators } from '~/services/follows';
import { getShopperGender } from '~/services/product-creative';
import { subscribeOnline } from '~/services/presence';
import { highResAvatarUrl } from '~/utils/avatarSrc';
import '~/styles/creator-constellation.css';

interface SavedProductLike {
  brand?: string | null;
  name?: string | null;
  image?: string | null;
  image_url?: string | null;
  primary_image_url?: string | null;
}

interface Props {
  /** Committed open (interactive + content mounted). The slide itself is the
   *  CSS var; this gates data load, body lock and the stagger. */
  open: boolean;
  onClose: () => void;
  onOpenCreator: (handle: string) => void;
  onOpenBrand: (brand: string) => void;
  /** The shopper's saved products — the source for "brands you like". */
  savedProducts?: SavedProductLike[];
}

interface CreatorTile {
  handle: string;
  name: string;
  avatarUrl: string | null;
  lastPostTs: number;
  lookCount: number;
  followed: boolean;
}

interface BrandTile {
  brand: string;
  saved: number;
  image: string | null;
}

function timeAgo(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

export default function CreatorConstellation({ open, onClose, onOpenCreator, onOpenBrand, savedProducts }: Props) {
  const reduce = useReducedMotion();
  const [creators, setCreators] = useState<CreatorTile[] | null>(null);
  const [onlineHandles, setOnlineHandles] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const brands = useMemo<BrandTile[]>(() => {
    const by = new Map<string, BrandTile>();
    for (const p of savedProducts ?? []) {
      const brand = (p.brand || '').trim();
      if (!brand) continue;
      const img = p.primary_image_url || p.image || p.image_url || null;
      const cur = by.get(brand);
      if (cur) { cur.saved += 1; if (!cur.image && img) cur.image = img; }
      else by.set(brand, { brand, saved: 1, image: img });
    }
    return [...by.values()].sort((a, b) => b.saved - a.saved).slice(0, 12);
  }, [savedProducts]);

  // Load creators when the page commits open (it's behind a pull, so never
  // on cold mount).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        let handles: string[] = [];
        try { handles = await getMyFollowing(); } catch { handles = []; }
        if (cancelled) return;

        if (handles.length === 0 || !supabase) {
          const pop = await getPopularCreators(getShopperGender(), { limit: 18 }).catch(() => []);
          if (cancelled) return;
          setCreators(pop.map(s => ({
            handle: s.handle, name: s.displayName || s.handle, avatarUrl: s.avatarUrl,
            lastPostTs: 0, lookCount: 0, followed: false,
          })));
          return;
        }

        const [crows, lrows] = await Promise.all([
          supabase.from('creators').select('handle, display_name, avatar_url').in('handle', handles),
          supabase.from('looks')
            .select('creator_handle, created_at')
            .in('creator_handle', handles)
            .eq('status', 'live')
            .order('created_at', { ascending: false }),
        ]);
        if (cancelled) return;
        type CRow = { handle: string; display_name: string | null; avatar_url: string | null };
        type LRow = { creator_handle: string; created_at: string | null };
        const cmap = new Map<string, CRow>(((crows.data || []) as CRow[]).map(r => [r.handle, r]));
        const lastPost = new Map<string, number>();
        const count = new Map<string, number>();
        for (const l of (lrows.data || []) as LRow[]) {
          count.set(l.creator_handle, (count.get(l.creator_handle) || 0) + 1);
          if (l.created_at && !lastPost.has(l.creator_handle)) {
            const ts = Date.parse(l.created_at);
            if (Number.isFinite(ts)) lastPost.set(l.creator_handle, ts);
          }
        }
        const tiles: CreatorTile[] = handles.map(h => ({
          handle: h,
          name: cmap.get(h)?.display_name || h.replace(/^user:/, ''),
          avatarUrl: cmap.get(h)?.avatar_url || null,
          lastPostTs: lastPost.get(h) ?? 0,
          lookCount: count.get(h) ?? 0,
          followed: true,
        }));
        tiles.sort((a, b) => b.lastPostTs - a.lastPostTs);
        setCreators(tiles);
      } catch {
        if (!cancelled) setCreators([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return subscribeOnline((s) => setOnlineHandles(new Set(s.handles)));
  }, [open]);

  // Lock the body scroll behind the page while it's open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Scroll up past the top → dismiss (a continuation of the pull/scroll).
  const overTopRef = useRef(0);
  const onScrollTouchMove = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= 0) {
      overTopRef.current += 1;
      if (overTopRef.current > 6) { overTopRef.current = 0; onClose(); }
    } else {
      overTopRef.current = 0;
    }
  };

  const followingCount = creators?.filter(c => c.followed).length ?? 0;
  const isSuggested = (creators?.length ?? 0) > 0 && followingCount === 0;

  const stagger = reduce ? 0 : 0.035;
  const spring = reduce
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 };

  return (
    <div className="cc-root" id="people-panel" aria-hidden={!open} role="dialog" aria-label="People and brands">
      <div className="cc-sheet">
        <div className="cc-scroll" ref={scrollRef} onTouchMove={onScrollTouchMove}>
          <div className="cc-grab" aria-hidden="true"><span /></div>
          <button className="cc-close" onClick={onClose} aria-label="Back to feed">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>

          {open && (
            <>
              <motion.header
                className="cc-head"
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : 0.04 }}
              >
                <h1 className="cc-title">Your orbit</h1>
                <p className="cc-sub">
                  {isSuggested
                    ? 'Creators worth following — and the brands you save will gather here.'
                    : `${followingCount} creator${followingCount === 1 ? '' : 's'} you follow${brands.length ? ` · ${brands.length} brand${brands.length === 1 ? '' : 's'} you love` : ''}`}
                </p>
              </motion.header>

              <section className="cc-section">
                <div className="cc-section-label">{isSuggested ? 'Discover creators' : 'Creators'}</div>
                {creators === null ? (
                  <div className="cc-grid cc-grid--creators">
                    {Array.from({ length: 9 }, (_, i) => (
                      <div className="cc-creator cc-creator--skel" key={`cs-${i}`}>
                        <span className="cc-avatar cc-avatar--skel" />
                        <span className="cc-skel-line" />
                      </div>
                    ))}
                  </div>
                ) : creators.length === 0 ? (
                  <p className="cc-empty">No creators yet — follow a few and they'll orbit here.</p>
                ) : (
                  <motion.div
                    className="cc-grid cc-grid--creators"
                    initial="hidden"
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: stagger } } }}
                  >
                    {creators.map((c) => {
                      const online = onlineHandles.has(c.handle.toLowerCase());
                      const insight = c.lastPostTs
                        ? timeAgo(c.lastPostTs)
                        : (c.lookCount ? `${c.lookCount} look${c.lookCount === 1 ? '' : 's'}` : 'New');
                      return (
                        <motion.button
                          type="button"
                          key={c.handle}
                          className="cc-creator"
                          onClick={() => onOpenCreator(c.handle)}
                          variants={{
                            hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.8 },
                            show: { opacity: 1, y: 0, scale: 1, transition: spring },
                          }}
                          whileTap={reduce ? undefined : { scale: 0.93 }}
                          aria-label={`Open ${c.name}'s catalog`}
                        >
                          <span className={`cc-avatar${online ? ' is-online' : ''}`}>
                            {c.avatarUrl
                              ? <img src={highResAvatarUrl(c.avatarUrl, 160) || c.avatarUrl} alt="" loading="lazy" decoding="async" draggable={false} />
                              : <span className="cc-initial">{c.name.charAt(0).toUpperCase()}</span>}
                            {online && <span className="cc-online-dot" aria-hidden="true" />}
                          </span>
                          <span className="cc-name">{c.name}</span>
                          <span className="cc-insight">{online ? 'online now' : insight}</span>
                        </motion.button>
                      );
                    })}
                  </motion.div>
                )}
              </section>

              {brands.length > 0 && (
                <section className="cc-section">
                  <div className="cc-section-label">Brands you love</div>
                  <motion.div
                    className="cc-grid cc-grid--brands"
                    initial="hidden"
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: stagger, delayChildren: reduce ? 0 : 0.08 } } }}
                  >
                    {brands.map((b) => (
                      <motion.button
                        type="button"
                        key={b.brand}
                        className="cc-brand"
                        onClick={() => onOpenBrand(b.brand)}
                        variants={{
                          hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.92 },
                          show: { opacity: 1, y: 0, scale: 1, transition: spring },
                        }}
                        whileTap={reduce ? undefined : { scale: 0.96 }}
                        aria-label={`Open ${b.brand}`}
                      >
                        <span className="cc-brand-thumb">
                          {b.image
                            ? <img src={b.image} alt="" loading="lazy" decoding="async" draggable={false} />
                            : <span className="cc-brand-mono">{b.brand.charAt(0).toUpperCase()}</span>}
                        </span>
                        <span className="cc-brand-meta">
                          <span className="cc-brand-name">{b.brand}</span>
                          <span className="cc-insight">{b.saved} saved</span>
                        </span>
                      </motion.button>
                    ))}
                  </motion.div>
                </section>
              )}

              <button className="cc-return" onClick={onClose}>Back to feed</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// AIStylist — the "AI Stylist" path of the /generate AI-look flow. The shopper
// describes an occasion ONCE; we semantic-search the catalog for pieces that
// actually match it, a reasoning model assembles an outfit (Hat · Tops ·
// Dresses · Bottoms · Shoes), and each slot is a horizontal reel — the centered
// item is the selection (bigger), and scrolling the reel changes it. On "Yes"
// it hands the chosen products + the occasion (reused as scene context) back to
// the generate flow, which continues at photos.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { supabase } from '~/utils/supabase';
import { type PickedProduct, roleTagFromName } from '~/services/product-roles';
import { getFeedSearchResults } from '~/services/feed-search';
import { suggestOutfit, STYLIST_SLOTS, type StylistOutfit, type StylistSlot } from '~/services/ai-stylist';

export interface StylistComplete {
  products: PickedProduct[];
  /** The occasion text — reused as the generation's scene context. */
  occasion: string;
}

interface Props {
  gender: string;              // 'male' | 'female' | 'unknown'
  onComplete: (result: StylistComplete) => void;
  onBack: () => void;
}

type StylistStep = 'ask' | 'result';

const EMPTY_OUTFIT: StylistOutfit = { hats: null, tops: null, dresses: null, bottoms: null, shoes: null };

const SLOT_ROLES: Record<StylistSlot, (role: string | null) => boolean> = {
  hats: r => r === 'Hat',
  tops: r => r === 'Top' || r === 'Jacket',
  dresses: r => r === 'Dress',
  bottoms: r => r === 'Pants',
  shoes: r => r === 'Shoes',
};

// Keep a product for a male shopper? (drop female-tagged + dresses)
function allowedForGender(p: PickedProduct & { gender?: string | null }, gender: string): boolean {
  if (gender === 'male') return p.gender !== 'female' && p.role_tag !== 'Dress';
  if (gender === 'female') return p.gender !== 'male';
  return true;
}

export default function AIStylist({ gender, onComplete, onBack }: Props) {
  const [step, setStep] = useState<StylistStep>('ask');
  const [occasion, setOccasion] = useState('');
  const [baseCandidates, setBaseCandidates] = useState<PickedProduct[]>([]);
  const [candidates, setCandidates] = useState<PickedProduct[]>([]);
  const [aiOutfit, setAiOutfit] = useState<StylistOutfit>(EMPTY_OUTFIT);
  const [outfit, setOutfit] = useState<StylistOutfit>(EMPTY_OUTFIT);
  const [rationale, setRationale] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Base catalog (active, gender-filtered) — slot coverage + browse fallback.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      let query = supabase!
        .from('products')
        .select('id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_video_poster_url, haiku_context, gender')
        .eq('is_active', true)
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(400);
      if (gender === 'male') query = query.or('gender.eq.male,gender.eq.unisex');
      else if (gender === 'female') query = query.or('gender.eq.female,gender.eq.unisex');
      const { data } = await query;
      if (cancelled) return;
      const mapped: PickedProduct[] = ((data || []) as Array<PickedProduct & { haiku_context?: string | null; gender?: string | null }>)
        .map(p => ({ ...p, role_tag: roleTagFromName(p.name) }))
        .filter(p => allowedForGender(p as PickedProduct & { gender?: string | null }, gender));
      setBaseCandidates(mapped);
    })();
    return () => { cancelled = true; };
  }, [gender]);

  const byId = useMemo(() => {
    const m = new Map<string, PickedProduct & { haiku_context?: string | null }>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  const runStylist = useCallback(async () => {
    if (!occasion.trim() || baseCandidates.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      // RELEVANCE: semantic-search the catalog for the occasion, so "working
      // out" actually surfaces athletic pieces. Merge those (ranked first) with
      // the base set so every slot still has options to browse.
      let relevant: PickedProduct[] = [];
      try {
        const hits = await getFeedSearchResults(occasion.trim(), 120);
        const seen = new Set<string>();
        for (const h of hits) {
          const p = h.product;
          if (!p?.id || seen.has(p.id) || !p.image_url) continue;
          seen.add(p.id);
          const cand: PickedProduct & { gender?: string | null; haiku_context?: string | null } = {
            id: p.id, name: p.name, brand: p.brand, price: p.price,
            image_url: p.image_url, primary_image_url: p.primary_image_url ?? null,
            primary_video_url: p.primary_video_url ?? null, primary_video_poster_url: p.primary_video_poster_url ?? null,
            role_tag: roleTagFromName(p.name), gender: p.gender ?? null,
          };
          if (allowedForGender(cand, gender)) relevant.push(cand);
        }
      } catch (err) {
        console.warn('[AIStylist] relevance search failed, using base set:', err);
      }

      // Merge relevant-first, then base (deduped).
      const merged: PickedProduct[] = [];
      const seen = new Set<string>();
      for (const p of [...relevant, ...baseCandidates]) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        merged.push(p);
      }
      setCandidates(merged);

      const payload = merged.slice(0, 150).map(c => ({
        id: c.id, name: c.name || '', brand: c.brand, price: c.price,
        role: c.role_tag, context: (c as { haiku_context?: string | null }).haiku_context ?? null,
      }));
      const result = await suggestOutfit(occasion, gender, payload);
      setAiOutfit(result.outfit);
      setOutfit(result.outfit);
      setRationale(result.rationale);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not style a look — try again.');
    } finally {
      setLoading(false);
    }
  }, [occasion, baseCandidates, gender]);

  const visibleSlots = useMemo(
    () => STYLIST_SLOTS.filter(s => {
      if (s.key === 'dresses' && gender === 'male') return false;
      return candidates.some(c => SLOT_ROLES[s.key](c.role_tag)) || !!outfit[s.key];
    }),
    [gender, candidates, outfit],
  );

  // Per-slot options, relevant-first (candidates are already merged that way).
  const slotItems = useMemo(() => {
    const map = new Map<StylistSlot, PickedProduct[]>();
    for (const s of visibleSlots) map.set(s.key, candidates.filter(c => SLOT_ROLES[s.key](c.role_tag)).slice(0, 40));
    return map;
  }, [visibleSlots, candidates]);

  const select = (slot: StylistSlot, id: string) => setOutfit(prev => {
    const next = { ...prev, [slot]: id };
    if (slot === 'dresses') { next.tops = null; next.bottoms = null; }
    else if (slot === 'tops' || slot === 'bottoms') { next.dresses = null; }
    return next;
  });

  const chosenProducts = useMemo(
    () => STYLIST_SLOTS
      .map(s => outfit[s.key])
      .filter((id): id is string => !!id)
      .map(id => byId.get(id))
      .filter((p): p is PickedProduct => !!p),
    [outfit, byId],
  );

  // ── ASK ── centered above the keyboard; CTA pops in after typing ──────
  if (step === 'ask') {
    return (
      <div className="gen-stylist gen-stylist--ask">
        <button type="button" className="gen-stylist-back" onClick={onBack} aria-label="Back">← Back</button>
        <div className="gen-stylist-askbody">
          <h1 className="gen-stylist-title">What do you want to wear?</h1>
          <p className="gen-stylist-sub">Tell me the occasion or the vibe — I&apos;ll style a whole look from the catalog.</p>
          <textarea
            className="gen-stylist-input"
            value={occasion}
            onChange={e => setOccasion(e.target.value)}
            placeholder="e.g. a look for date night, working out, first day at a new job…"
            rows={3}
            autoFocus
          />
          {error && <div className="gen-error">{error}</div>}
          {occasion.trim().length > 0 && (
            <button
              type="button"
              className="gen-btn-primary gen-stylist-cta gen-stylist-cta--pop"
              disabled={loading || baseCandidates.length === 0}
              onClick={runStylist}
            >
              {loading ? 'Styling…' : 'Style my look'}
            </button>
          )}
        </div>
        {loading && <StylistLoading />}
      </div>
    );
  }

  // ── RESULT ── one viewport, horizontal reels (scroll to pick) ─────────
  return (
    <div className="gen-stylist gen-stylist--result">
      <button type="button" className="gen-stylist-back" onClick={() => setStep('ask')} aria-label="Back">← Back</button>
      <div className="gen-stylist-resulthead">
        <h1 className="gen-stylist-title gen-stylist-title--sm">Here&apos;s your look</h1>
        {rationale && <p className="gen-stylist-rationale">{rationale}</p>}
      </div>

      <div className="gen-stylist-reels">
        {visibleSlots.map(slot => {
          const items = slotItems.get(slot.key) || [];
          const selId = outfit[slot.key];
          const sel = selId ? byId.get(selId) : null;
          return (
            <div key={slot.key} className="gen-stylist-reel">
              <div className="gen-stylist-reel-head">
                <span className="gen-stylist-reel-label">{slot.label}</span>
                {sel && (
                  <span className="gen-stylist-reel-desc">
                    {[sel.brand, sel.name].filter(Boolean).join(' · ') || 'Product'}{sel.price ? ` — ${sel.price}` : ''}
                  </span>
                )}
              </div>
              <Reel items={items} selectedId={selId} onSelect={(id) => select(slot.key, id)} delay={visibleSlots.indexOf(slot) * 0.12} />
            </div>
          );
        })}
      </div>

      <div className="gen-stylist-foot">
        <button
          type="button"
          className="gen-btn-primary gen-stylist-cta"
          disabled={chosenProducts.length === 0}
          onClick={() => onComplete({ products: chosenProducts, occasion: occasion.trim() })}
        >
          Yes, I like it
        </button>
      </div>
    </div>
  );
}

// One slot's horizontal reel: scroll-snap row where the CENTERED item is the
// selection (rendered bigger). Scrolling re-centers → re-selects; tapping an
// item glides it to center.
function Reel({ items, selectedId, onSelect, delay = 0 }: { items: PickedProduct[]; selectedId: string | null; onSelect: (id: string) => void; delay?: number }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  // GSAP entrance: glide the reel from the start and settle, eased, onto the
  // styled pick — staggered per row so the look assembles slot by slot.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !selectedId) return;
    const el = track.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    if (!el) return;
    const target = Math.max(0, el.offsetLeft - (track.clientWidth - el.clientWidth) / 2);
    const tween = gsap.fromTo(track, { scrollLeft: 0 }, { scrollLeft: target, duration: 0.95, ease: 'power3.out', delay });
    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const center = track.scrollLeft + track.clientWidth / 2;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const child of Array.from(track.children) as HTMLElement[]) {
        const id = child.dataset.id;
        if (!id) continue;
        const c = child.offsetLeft + child.clientWidth / 2;
        const d = Math.abs(c - center);
        if (d < bestDist) { bestDist = d; bestId = id; }
      }
      if (bestId && bestId !== selectedId) onSelect(bestId);
    });
  };

  const tapTo = (id: string) => {
    const track = trackRef.current;
    const el = track?.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (track && el) track.scrollTo({ left: el.offsetLeft - (track.clientWidth - el.clientWidth) / 2, behavior: 'smooth' });
    onSelect(id);
  };

  return (
    <div className="gen-stylist-reel-track" ref={trackRef} onScroll={onScroll} data-lenis-prevent>
      {items.length === 0 && <span className="gen-stylist-reel-none">Nothing here yet</span>}
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          data-id={item.id}
          className={`gen-stylist-chip${item.id === selectedId ? ' is-selected' : ''}`}
          onClick={() => tapTo(item.id)}
          aria-label={item.name || 'Product'}
        >
          {item.image_url
            ? <img src={item.image_url} alt="" loading="lazy" />
            : <span className="gen-stylist-chip-empty" />}
        </button>
      ))}
    </div>
  );
}

// "Styling your look…" moment while search + the reasoning model run.
function StylistLoading() {
  const lines = ['Reading the occasion…', 'Searching the catalog…', 'Balancing the palette…', 'Putting the look together…'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI(v => (v + 1) % lines.length), 1800);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="gen-stylist-loading" aria-live="polite">
      <div className="gen-stylist-loading-orb" aria-hidden="true" />
      <div className="gen-stylist-loading-text">{lines[i]}</div>
    </div>
  );
}

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
import { type PickedProduct, roleForProduct } from '~/services/product-roles';
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

type StylistStep = 'ask' | 'types' | 'result';

const EMPTY_OUTFIT: StylistOutfit = { hats: null, tops: null, jackets: null, dresses: null, bottoms: null, shoes: null };

const SLOT_ROLES: Record<StylistSlot, (role: string | null) => boolean> = {
  hats: r => r === 'Hat',
  tops: r => r === 'Top',
  jackets: r => r === 'Jacket',
  dresses: r => r === 'Dress',
  bottoms: r => r === 'Pants',
  shoes: r => r === 'Shoes',
};

// The garment-type chooser the shopper sees after the occasion ask. Each maps
// to the stylist slot(s) it fills. "Bottoms" == the bottoms slot.
const GARMENT_TYPES: { key: StylistSlot; label: string }[] = [
  { key: 'hats', label: 'Hat' },
  { key: 'tops', label: 'Tops' },
  { key: 'jackets', label: 'Jackets' },
  { key: 'bottoms', label: 'Bottoms' },
  { key: 'dresses', label: 'Dresses' },
  { key: 'shoes', label: 'Shoes' },
];

// Women-only garment classes a male shopper must never see — belt-and-
// suspenders for rows mis-tagged unisex/null whose NAME gives them away
// (e.g. "Femme LA Tokyo Thong Sandal" heels).
const WOMEN_ONLY_NAME_RE = /\b(heel|heels|stiletto|pump|pumps|gown|skirt|blouse|camisole|cami|bodysuit|slingback|wedge|wedges|espadrille|thong sandal|peep[\s-]?toe|bralette|bustier|corset|romper|jumpsuit|maxi|midi dress|mini dress)\b/i;

// Keep a product for the shopper's gender. Drops opposite-sex-tagged rows AND,
// for men, anything reading women-only by name even when tagged unisex/null.
function allowedForGender(p: PickedProduct & { gender?: string | null }, gender: string): boolean {
  if (gender === 'male') {
    if (p.gender === 'female') return false;
    if (p.role_tag === 'Dress') return false;
    if (WOMEN_ONLY_NAME_RE.test(p.name || '')) return false;
    return true;
  }
  if (gender === 'female') return p.gender !== 'male';
  return true;
}

export default function AIStylist({ gender, onComplete, onBack }: Props) {
  const [step, setStep] = useState<StylistStep>('ask');
  const [occasion, setOccasion] = useState('');
  // Garment types the shopper asked for — dictates which slots get assembled
  // and shown. Defaults to a sensible everyday fit (tops + bottoms + shoes).
  const [wantedTypes, setWantedTypes] = useState<StylistSlot[]>(['tops', 'bottoms', 'shoes']);
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
        .select('id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_video_poster_url, haiku_context, gender, type')
        .eq('is_active', true)
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(400);
      if (gender === 'male') query = query.or('gender.eq.male,gender.eq.unisex');
      else if (gender === 'female') query = query.or('gender.eq.female,gender.eq.unisex');
      const { data } = await query;
      if (cancelled) return;
      const mapped: PickedProduct[] = ((data || []) as Array<PickedProduct & { haiku_context?: string | null; gender?: string | null; type?: string | null }>)
        .map(p => ({ ...p, role_tag: roleForProduct(p.type, p.name) }))
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

  // Keyboard inset for the ask/types steps. The bottom bar is a FIXED floating
  // pill (same treatment as the manual flow's .gen-dock) so it's always on
  // screen + tappable. iOS Safari leaves position:fixed bottom elements BEHIND
  // the keyboard, and ignores interactive-widget=resizes-content — but the
  // VisualViewport DOES exclude the keyboard. Mirror the keyboard height into a
  // --gen-kb-inset custom property so the bar (and the body's bottom padding)
  // lift above the keyboard. 0 when the keyboard is down → the bar sits at the
  // normal bottom, exactly like the manual dock. Only while a keyboard-bearing
  // step is mounted; cleared on unmount / step change.
  useEffect(() => {
    if (step !== 'ask' && step !== 'types') return;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--gen-kb-inset', `${Math.round(inset)}px`);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--gen-kb-inset');
    };
  }, [step]);

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
            role_tag: roleForProduct(p.type, p.name), gender: p.gender ?? null,
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
        gender: (c as { gender?: string | null }).gender ?? null,
      }));
      // A male shopper never gets the dresses slot, whatever was requested.
      const slots = wantedTypes.filter(s => !(s === 'dresses' && gender === 'male'));
      const result = await suggestOutfit(occasion, gender, payload, slots);
      setAiOutfit(result.outfit);
      setOutfit(result.outfit);
      setRationale(result.rationale);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not style a look. Try again.');
    } finally {
      setLoading(false);
    }
  }, [occasion, baseCandidates, gender, wantedTypes]);

  // Only the requested garment types become slots. A male shopper never gets
  // dresses. A slot still needs at least one matching candidate (or an existing
  // pick) to render a row.
  const visibleSlots = useMemo(
    () => STYLIST_SLOTS.filter(s => {
      if (!wantedTypes.includes(s.key)) return false;
      if (s.key === 'dresses' && gender === 'male') return false;
      return candidates.some(c => SLOT_ROLES[s.key](c.role_tag)) || !!outfit[s.key];
    }),
    [gender, candidates, outfit, wantedTypes],
  );

  // Per-slot options, relevant-first (candidates are already merged that way),
  // then re-centered so the stylist's INITIAL pick sits in the MIDDLE of the
  // row with alternatives split to flank it on both sides. Keyed off aiOutfit
  // (not the live outfit) so manually scrolling/tapping doesn't re-shuffle.
  const slotItems = useMemo(() => {
    const map = new Map<StylistSlot, PickedProduct[]>();
    for (const s of visibleSlots) {
      const items = candidates.filter(c => SLOT_ROLES[s.key](c.role_tag)).slice(0, 40);
      const pickId = aiOutfit[s.key];
      const pickIdx = pickId ? items.findIndex(i => i.id === pickId) : -1;
      if (pickIdx <= 0) { map.set(s.key, items); continue; }
      // Split the rest around the pick: half to the left, half to the right, so
      // the selection lands dead-center with alternatives flanking it.
      const pick = items[pickIdx];
      const rest = items.filter((_, i) => i !== pickIdx);
      const mid = Math.floor(rest.length / 2);
      map.set(s.key, [...rest.slice(0, mid), pick, ...rest.slice(mid)]);
    }
    return map;
  }, [visibleSlots, candidates, aiOutfit]);

  // Rank badges for the reel — a tiny 1 · 2 · 3 in each thumbnail's corner that
  // alludes to the stylist's ranking. The AI's pick is 1, the next two most
  // relevant alternates are 2 and 3; deeper cuts get no number, so scrolling
  // counts 1 → 2 → 3 then stops. Keyed off aiOutfit (not the live outfit) so it
  // stays put as the shopper scrolls/selects.
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of visibleSlots) {
      const ranked = candidates.filter(c => SLOT_ROLES[s.key](c.role_tag));
      const pickId = aiOutfit[s.key];
      const ordered = pickId
        ? [...ranked.filter(c => c.id === pickId), ...ranked.filter(c => c.id !== pickId)]
        : ranked;
      ordered.slice(0, 3).forEach((p, i) => m.set(p.id, i + 1));
    }
    return m;
  }, [visibleSlots, candidates, aiOutfit]);

  const select = (slot: StylistSlot, id: string) => setOutfit(prev => {
    const next = { ...prev, [slot]: id };
    if (slot === 'dresses') { next.tops = null; next.bottoms = null; }
    else if (slot === 'tops' || slot === 'bottoms') { next.dresses = null; }
    return next;
  });

  // Toggle a garment type in/out of the requested set (multi-select). Keep the
  // STYLIST_SLOTS order so the chosen set always reads top → bottom.
  const toggleType = (key: StylistSlot) => setWantedTypes(prev => (
    prev.includes(key)
      ? prev.filter(k => k !== key)
      : STYLIST_SLOTS.map(s => s.key).filter(k => k === key || prev.includes(k))
  ));

  const chosenProducts = useMemo(
    () => STYLIST_SLOTS
      .map(s => outfit[s.key])
      .filter((id): id is string => !!id)
      .map(id => byId.get(id))
      .filter((p): p is PickedProduct => !!p),
    [outfit, byId],
  );

  // ── ASK ── centered above the keyboard; the bottom console keeps Back +
  // submit together on one row, all visible with the keyboard up ──────────
  if (step === 'ask') {
    return (
      <div className="gen-stylist gen-stylist--ask">
        <div className="gen-stylist-askbody">
          <h1 className="gen-stylist-title">What do you want to wear?</h1>
          <p className="gen-stylist-sub">Tell me the occasion or the vibe. I&apos;ll style a whole look from the catalog.</p>
          <textarea
            className="gen-stylist-input"
            value={occasion}
            onChange={e => setOccasion(e.target.value)}
            placeholder="e.g. a look for date night, working out, first day at a new job…"
            rows={3}
            autoFocus
          />
          {error && <div className="gen-error">{error}</div>}
        </div>
        {/* Bottom console — Back + submit on one row, pinned above the keyboard. */}
        <div className="gen-stylist-foot gen-stylist-console">
          <button
            type="button"
            className="gen-stylist-console-back"
            onClick={onBack}
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            <span>Back</span>
          </button>
          {occasion.trim().length > 0 && (
            <button
              type="button"
              className="gen-btn-primary gen-stylist-cta gen-stylist-cta--pop gen-stylist-console-go"
              onClick={() => setStep('types')}
            >
              Next
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── TYPES ── pick which garment types to include in the fit ───────────
  if (step === 'types') {
    const opts = GARMENT_TYPES.filter(t => !(t.key === 'dresses' && gender === 'male'));
    return (
      <div className="gen-stylist gen-stylist--ask">
        <div className="gen-stylist-askbody">
          <h1 className="gen-stylist-title">What should the look include?</h1>
          <p className="gen-stylist-sub">Pick the pieces you want me to style. A dress stands in for a top + pants.</p>
          <div className="gen-stylist-types">
            {opts.map(t => {
              const on = wantedTypes.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  className={`gen-stylist-type${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleType(t.key)}
                >
                  <span className="gen-stylist-type-check" aria-hidden="true">
                    {on && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </span>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
          {error && <div className="gen-error">{error}</div>}
        </div>
        <div className="gen-stylist-foot gen-stylist-console">
          <button type="button" className="gen-stylist-console-back" onClick={() => setStep('ask')} aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            <span>Back</span>
          </button>
          <button
            type="button"
            className="gen-btn-primary gen-stylist-cta gen-stylist-console-go"
            disabled={loading || wantedTypes.length === 0 || baseCandidates.length === 0}
            onClick={runStylist}
          >
            {loading ? 'Styling…' : 'Style my look'}
          </button>
        </div>
        {loading && <StylistLoading />}
      </div>
    );
  }

  // ── RESULT ── one viewport, horizontal reels (scroll to pick) ─────────
  return (
    <div className="gen-stylist gen-stylist--result">
      <button type="button" className="gen-stylist-back" onClick={() => setStep('types')} aria-label="Back">← Back</button>
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
              <Reel items={items} selectedId={selId} onSelect={(id) => select(slot.key, id)} rankById={rankById} delay={visibleSlots.indexOf(slot) * 0.12} />
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
function Reel({ items, selectedId, onSelect, rankById, delay = 0 }: { items: PickedProduct[]; selectedId: string | null; onSelect: (id: string) => void; rankById: Map<string, number>; delay?: number }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  // True while the GSAP entrance is running, so the scroll listener doesn't
  // hijack the stylist's pick as the row glides past intermediate items.
  const animatingRef = useRef(false);

  // GSAP entrance: the row starts shifted off to the left, then glides and
  // settles — eased — onto the styled pick, which sits dead-center. Staggered
  // per row so the look visibly assembles slot by slot.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !selectedId) return;
    const el = track.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    if (!el) return;
    const target = Math.max(0, el.offsetLeft - (track.clientWidth - el.clientWidth) / 2);
    animatingRef.current = true;
    // Fade + lift the whole row in alongside the scroll-into-place glide.
    gsap.fromTo(track, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out', delay });
    const tween = gsap.fromTo(
      track,
      { scrollLeft: 0 },
      { scrollLeft: target, duration: 0.95, ease: 'power3.out', delay, onComplete: () => { animatingRef.current = false; } },
    );
    return () => { tween.kill(); animatingRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || animatingRef.current) return;
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
          {rankById.get(item.id) != null && (
            <span className="gen-stylist-chip-rank" aria-hidden="true">{rankById.get(item.id)}</span>
          )}
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
      <div className="gen-stylist-loading-text">{lines[i]}</div>
    </div>
  );
}

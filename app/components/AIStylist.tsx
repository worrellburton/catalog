// AIStylist — the "AI Stylist" path of the /generate AI-look flow. The shopper
// describes an occasion ONCE; a reasoning model assembles an outfit from the
// live catalog (Hat · Tops · Dresses · Bottoms · Shoes). Each slot shows a
// centered row of options that animates into place on the styled pick; tapping
// a product selects it and reveals its description + a Change button (full
// picker). On "Yes" it hands the chosen products + the original occasion (reused
// as the scene context) back to the generate flow, which continues at photos.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { type PickedProduct, roleTagFromName } from '~/services/product-roles';
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

// Which role tags fill each slot.
const SLOT_ROLES: Record<StylistSlot, (role: string | null) => boolean> = {
  hats: r => r === 'Hat',
  tops: r => r === 'Top' || r === 'Jacket',
  dresses: r => r === 'Dress',
  bottoms: r => r === 'Pants',
  shoes: r => r === 'Shoes',
};

// Order a slot's options so the styled pick sits in the MIDDLE (so a centered,
// non-scrolling row keeps the selection visible), with a few neighbours each side.
function centeredWindow(all: PickedProduct[], selectedId: string | null): PickedProduct[] {
  if (all.length === 0) return [];
  if (!selectedId) return all.slice(0, 9);
  const idx = all.findIndex(a => a.id === selectedId);
  if (idx < 0) return all.slice(0, 9);
  return [...all.slice(Math.max(0, idx - 4), idx), all[idx], ...all.slice(idx + 1, idx + 5)];
}

export default function AIStylist({ gender, onComplete, onBack }: Props) {
  const [step, setStep] = useState<StylistStep>('ask');
  const [occasion, setOccasion] = useState('');
  const [candidates, setCandidates] = useState<PickedProduct[]>([]);
  // aiOutfit = the model's original pick (drives the centered rows, stays stable);
  // outfit = the user's current selection (drives the highlight).
  const [aiOutfit, setAiOutfit] = useState<StylistOutfit>(EMPTY_OUTFIT);
  const [outfit, setOutfit] = useState<StylistOutfit>(EMPTY_OUTFIT);
  const [rationale, setRationale] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapSlot, setSwapSlot] = useState<StylistSlot | null>(null);
  // Slots the user has tapped — reveals the description + Change button.
  const [revealedSlots, setRevealedSlots] = useState<Set<StylistSlot>>(new Set());

  // Load the candidate catalog once (active + gender-filtered, like the picker).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      let query = supabase!
        .from('products')
        .select('id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_video_poster_url, haiku_context')
        .eq('is_active', true)
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(400);
      if (gender === 'male') query = query.or('gender.eq.male,gender.eq.unisex');
      else if (gender === 'female') query = query.or('gender.eq.female,gender.eq.unisex');
      const { data } = await query;
      if (cancelled) return;
      const mapped: PickedProduct[] = ((data || []) as Array<PickedProduct & { haiku_context?: string | null }>).map(p => ({
        ...p,
        role_tag: roleTagFromName(p.name),
      }));
      // Dresses are women-only — never offer them to a male shopper.
      setCandidates(gender === 'male' ? mapped.filter(p => p.role_tag !== 'Dress') : mapped);
    })();
    return () => { cancelled = true; };
  }, [gender]);

  const byId = useMemo(() => {
    const m = new Map<string, PickedProduct & { haiku_context?: string | null }>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  const runStylist = useCallback(async () => {
    if (!occasion.trim() || candidates.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const payload = candidates.slice(0, 150).map(c => ({
        id: c.id,
        name: c.name || '',
        brand: c.brand,
        price: c.price,
        role: c.role_tag,
        context: (c as { haiku_context?: string | null }).haiku_context ?? null,
      }));
      const result = await suggestOutfit(occasion, gender, payload);
      setAiOutfit(result.outfit);
      setOutfit(result.outfit);
      setRationale(result.rationale);
      setRevealedSlots(new Set());
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not style a look — try again.');
    } finally {
      setLoading(false);
    }
  }, [occasion, candidates, gender]);

  // Visible slots: hide Dresses for men; only show slots the catalog can fill.
  const visibleSlots = useMemo(
    () => STYLIST_SLOTS.filter(s => {
      if (s.key === 'dresses' && gender === 'male') return false;
      return candidates.some(c => SLOT_ROLES[s.key](c.role_tag)) || !!outfit[s.key];
    }),
    [gender, candidates, outfit],
  );

  // Stable per-slot row, centered on the model's original pick.
  const slotRows = useMemo(() => {
    const map = new Map<StylistSlot, PickedProduct[]>();
    for (const s of visibleSlots) {
      const all = candidates.filter(c => SLOT_ROLES[s.key](c.role_tag));
      map.set(s.key, centeredWindow(all, aiOutfit[s.key]));
    }
    return map;
  }, [visibleSlots, candidates, aiOutfit]);

  const selectItem = (slot: StylistSlot, id: string) => {
    setOutfit(prev => {
      const next = { ...prev, [slot]: id };
      if (slot === 'dresses') { next.tops = null; next.bottoms = null; }
      else if (slot === 'tops' || slot === 'bottoms') { next.dresses = null; }
      return next;
    });
    setRevealedSlots(prev => new Set(prev).add(slot));
  };

  const pickSwap = (slot: StylistSlot, id: string) => {
    selectItem(slot, id);
    setSwapSlot(null);
  };

  const swapItems = useMemo(
    () => (swapSlot ? candidates.filter(c => SLOT_ROLES[swapSlot](c.role_tag)) : []),
    [swapSlot, candidates],
  );

  const chosenProducts = useMemo(
    () => STYLIST_SLOTS
      .map(s => outfit[s.key])
      .filter((id): id is string => !!id)
      .map(id => byId.get(id))
      .filter((p): p is PickedProduct => !!p),
    [outfit, byId],
  );

  // ── ASK ─────────────────────────────────────────────────────────────
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
            placeholder="e.g. a look for date night, first day at a new job, beach weekend…"
            rows={3}
            autoFocus
          />
          {error && <div className="gen-error">{error}</div>}
          {/* CTA only appears once they've described something. */}
          {occasion.trim().length > 0 && (
            <button
              type="button"
              className="gen-btn-primary gen-stylist-cta gen-stylist-cta--pop"
              disabled={loading || candidates.length === 0}
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

  // ── RESULT ── one viewport, centered animated rows, tap to select ─────
  return (
    <div className="gen-stylist gen-stylist--result">
      <button type="button" className="gen-stylist-back" onClick={() => setStep('ask')} aria-label="Back">← Back</button>
      <div className="gen-stylist-resulthead">
        <h1 className="gen-stylist-title gen-stylist-title--sm">Here&apos;s your look</h1>
        {rationale && <p className="gen-stylist-rationale">{rationale}</p>}
      </div>

      <div className="gen-stylist-reels">
        {visibleSlots.map((slot, i) => {
          const items = slotRows.get(slot.key) || [];
          const selId = outfit[slot.key];
          const sel = selId ? byId.get(selId) : null;
          const revealed = revealedSlots.has(slot.key);
          return (
            <div key={slot.key} className="gen-stylist-reel">
              <div className="gen-stylist-reel-head">
                {revealed && sel ? (
                  <>
                    <span className="gen-stylist-reel-desc">
                      {[sel.brand, sel.name].filter(Boolean).join(' · ') || 'Product'}{sel.price ? ` — ${sel.price}` : ''}
                    </span>
                    <button type="button" className="gen-stylist-reel-change" onClick={() => setSwapSlot(slot.key)}>Change</button>
                  </>
                ) : (
                  <span className="gen-stylist-reel-label">{slot.label}</span>
                )}
              </div>
              <div className="gen-stylist-reel-track" style={{ animationDelay: `${i * 90}ms` }}>
                {items.length === 0 && <span className="gen-stylist-reel-none">Nothing here yet</span>}
                {items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={`gen-stylist-chip${item.id === selId ? ' is-selected' : ''}`}
                    onClick={() => selectItem(slot.key, item.id)}
                    aria-label={item.name || 'Product'}
                  >
                    {item.image_url
                      ? <img src={item.image_url} alt="" loading="lazy" />
                      : <span className="gen-stylist-chip-empty" />}
                  </button>
                ))}
              </div>
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

      {swapSlot && (
        <div className="gen-stylist-swap" role="dialog" aria-label={`Choose ${swapSlot}`}>
          <div className="gen-stylist-swap-head">
            <span>Choose {STYLIST_SLOTS.find(s => s.key === swapSlot)?.label.toLowerCase()}</span>
            <button type="button" className="gen-stylist-swap-close" onClick={() => setSwapSlot(null)} aria-label="Close">×</button>
          </div>
          <div className="gen-stylist-swap-grid">
            {swapItems.length === 0 && <div className="gen-empty">No options in the catalog yet.</div>}
            {swapItems.map(item => (
              <button key={item.id} type="button" className="gen-stylist-swap-card" onClick={() => pickSwap(swapSlot, item.id)} aria-label={item.name || 'Product'}>
                {item.image_url
                  ? <img src={item.image_url} alt="" loading="lazy" />
                  : <span className="gen-stylist-swap-card-empty" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// "Styling your look…" moment while the reasoning model runs.
function StylistLoading() {
  const lines = ['Reading the occasion…', 'Pulling pieces from the catalog…', 'Balancing the palette…', 'Putting the look together…'];
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

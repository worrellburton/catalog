// AIStylist — the "AI Stylist" path of the /generate AI-look flow. The shopper
// describes an occasion, a reasoning model assembles ONE outfit from the live
// catalog (Tops · Dresses · Bottoms · Shoes, stacked top→bottom), they can swap
// any single piece (manual-picker style) or accept it, then answer what they'll
// be doing in the look. On finish it hands the chosen products + occasion +
// activity back to the generate flow, which picks up at the photos step.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { type PickedProduct, roleTagFromName } from '~/services/product-roles';
import { suggestOutfit, STYLIST_SLOTS, type StylistOutfit, type StylistSlot } from '~/services/ai-stylist';

export interface StylistComplete {
  products: PickedProduct[];
  occasion: string;
  activity: string;
}

interface Props {
  gender: string;              // 'male' | 'female' | 'unknown'
  onComplete: (result: StylistComplete) => void;
  onBack: () => void;
}

type StylistStep = 'ask' | 'result' | 'activity';

const EMPTY_OUTFIT: StylistOutfit = { hats: null, tops: null, dresses: null, bottoms: null, shoes: null };

// Which role tags fill each slot (for swap filtering).
const SLOT_ROLES: Record<StylistSlot, (role: string | null) => boolean> = {
  hats: r => r === 'Hat',
  tops: r => r === 'Top' || r === 'Jacket',
  dresses: r => r === 'Dress',
  bottoms: r => r === 'Pants',
  shoes: r => r === 'Shoes',
};

export default function AIStylist({ gender, onComplete, onBack }: Props) {
  const [step, setStep] = useState<StylistStep>('ask');
  const [occasion, setOccasion] = useState('');
  const [activity, setActivity] = useState('');
  const [candidates, setCandidates] = useState<PickedProduct[]>([]);
  const [outfit, setOutfit] = useState<StylistOutfit>(EMPTY_OUTFIT);
  const [rationale, setRationale] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapSlot, setSwapSlot] = useState<StylistSlot | null>(null);
  const [refining, setRefining] = useState(false);
  // Slots whose description the user has tapped open (image-only until then).
  const [revealedSlots, setRevealedSlots] = useState<Set<StylistSlot>>(new Set());
  const askRef = useRef<HTMLTextAreaElement>(null);

  const toggleReveal = (slot: StylistSlot) => setRevealedSlots(prev => {
    const next = new Set(prev);
    if (next.has(slot)) next.delete(slot); else next.add(slot);
    return next;
  });

  // Visible slots: hide Dresses for men (and only show a slot if the catalog
  // actually has something for it, so empty rows don't clutter the look).
  const visibleSlots = useMemo(
    () => STYLIST_SLOTS.filter(s => {
      if (s.key === 'dresses' && gender === 'male') return false;
      return candidates.some(c => SLOT_ROLES[s.key](c.role_tag)) || !!outfit[s.key];
    }),
    [gender, candidates, outfit],
  );

  // Load the candidate catalog once (same active + gender-filtered set the
  // manual picker uses). Powers both the reasoning call and the swap sheet.
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

  // Quick id → product lookup.
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
      setOutfit(result.outfit);
      setRationale(result.rationale);
      setRefining(false);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not style a look — try again.');
    } finally {
      setLoading(false);
    }
  }, [occasion, candidates, gender]);

  // Swap a single slot to the chosen product (manual-picker style).
  const swapItems = useMemo(() => {
    if (!swapSlot) return [];
    return candidates.filter(c => SLOT_ROLES[swapSlot](c.role_tag));
  }, [swapSlot, candidates]);

  const pickSwap = (slot: StylistSlot, id: string) => {
    setOutfit(prev => {
      const next = { ...prev, [slot]: id };
      // A dress replaces top+bottom and vice-versa, mirroring the model's rule.
      if (slot === 'dresses') { next.tops = null; next.bottoms = null; }
      else if (slot === 'tops' || slot === 'bottoms') { next.dresses = null; }
      return next;
    });
    setSwapSlot(null);
  };

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
          <p className="gen-stylist-sub">Tell me the occasion or the vibe — I&apos;ll style a look from the catalog.</p>
          <textarea
            ref={askRef}
            className="gen-stylist-input"
            value={occasion}
            onChange={e => setOccasion(e.target.value)}
            placeholder="e.g. rooftop dinner in LA, first day at a new job, beach weekend…"
            rows={3}
            autoFocus
          />
          {error && <div className="gen-error">{error}</div>}
        </div>
        <div className="gen-stylist-foot">
          <button
            type="button"
            className="gen-btn-primary gen-stylist-cta"
            disabled={!occasion.trim() || loading || candidates.length === 0}
            onClick={runStylist}
          >
            {loading ? 'Styling…' : 'Style my look'}
          </button>
        </div>
        {loading && <StylistLoading />}
      </div>
    );
  }

  // ── RESULT ──────────────────────────────────────────────────────────
  if (step === 'result') {
    return (
      <div className="gen-stylist gen-stylist--result">
        <button type="button" className="gen-stylist-back" onClick={() => setStep('ask')} aria-label="Back">← Back</button>
        <div className="gen-stylist-resultbody">
          <h1 className="gen-stylist-title">Here&apos;s your look</h1>
          {rationale && <p className="gen-stylist-sub">{rationale}</p>}
          {refining && <p className="gen-stylist-hint">Tap a piece to see what it is, or Change to swap it.</p>}

          <div className="gen-stylist-stack">
            {visibleSlots.map(slot => {
              const id = outfit[slot.key];
              const p = id ? byId.get(id) : null;
              const revealed = revealedSlots.has(slot.key);
              return (
                <div key={slot.key} className="gen-stylist-row">
                  <div className="gen-stylist-row-head">
                    <span className="gen-stylist-row-label">{slot.label}</span>
                    <button type="button" className="gen-stylist-row-change" onClick={() => setSwapSlot(slot.key)}>
                      {p ? 'Change' : 'Add'}
                    </button>
                  </div>
                  {p ? (
                    <button type="button" className="gen-stylist-thumb" onClick={() => toggleReveal(slot.key)} aria-label={p.name || 'Product'}>
                      {p.image_url
                        ? <img src={p.image_url} alt="" loading="lazy" />
                        : <span className="gen-stylist-thumb-empty" />}
                    </button>
                  ) : (
                    <button type="button" className="gen-stylist-thumb gen-stylist-thumb--add" onClick={() => setSwapSlot(slot.key)} aria-label={`Add ${slot.label}`}>+</button>
                  )}
                  {p && revealed && (
                    <div className="gen-stylist-desc">
                      {p.brand && <span className="gen-stylist-desc-brand">{p.brand}</span>}
                      <span className="gen-stylist-desc-name">{p.name || 'Product'}</span>
                      {p.price && <span className="gen-stylist-desc-price">{p.price}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="gen-stylist-foot gen-stylist-foot--choice">
          <button type="button" className="gen-btn-secondary" onClick={() => setRefining(true)}>No, change it</button>
          <button
            type="button"
            className="gen-btn-primary"
            disabled={chosenProducts.length === 0}
            onClick={() => setStep('activity')}
          >
            Yes, I like it
          </button>
        </div>

        {swapSlot && (
          <div className="gen-stylist-swap" role="dialog" aria-label={`Swap ${swapSlot}`}>
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

  // ── ACTIVITY ────────────────────────────────────────────────────────
  return (
    <div className="gen-stylist gen-stylist--activity">
      <button type="button" className="gen-stylist-back" onClick={() => setStep('result')} aria-label="Back">← Back</button>
      <div className="gen-stylist-askbody">
        <h1 className="gen-stylist-title">What do you want to be doing while wearing your look?</h1>
        <p className="gen-stylist-sub">We&apos;ll set the scene around it.</p>
        <textarea
          className="gen-stylist-input"
          value={activity}
          onChange={e => setActivity(e.target.value)}
          placeholder="e.g. walking through the city at golden hour, dancing at a wedding…"
          rows={3}
          autoFocus
        />
      </div>
      <div className="gen-stylist-foot">
        <button
          type="button"
          className="gen-btn-primary gen-stylist-cta"
          onClick={() => onComplete({ products: chosenProducts, occasion: occasion.trim(), activity: activity.trim() })}
        >
          Next
        </button>
      </div>
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

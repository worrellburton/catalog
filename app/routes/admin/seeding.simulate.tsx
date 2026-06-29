// Admin · Seeding · Simulate — coverage tester. Give a scenario + a sample
// shopper (gender), and we run the REAL ai-stylist against today's LIVE catalog
// to show the outfit it can assemble and, crucially, the EMPTY SLOTS (gaps).
// Each gap can be turned into an approved seed target in one click. Reuses the
// consumer stylist exactly (suggestOutfit + roleForProduct). See
// docs/CATALOG_SEEDING.md.

import { useCallback, useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { type PickedProduct, roleForProduct } from '~/services/product-roles';
import { suggestOutfit, STYLIST_SLOTS, type StylistOutfit, type StylistSlot } from '~/services/ai-stylist';

const EMPTY: StylistOutfit = { hats: null, tops: null, jackets: null, dresses: null, bottoms: null, shoes: null };

export default function SimulatePage() {
  const [scenario, setScenario] = useState('');
  const [gender, setGender] = useState('female');
  const [outfit, setOutfit] = useState<StylistOutfit>(EMPTY);
  const [byId, setById] = useState<Map<string, PickedProduct>>(new Map());
  const [candidateCount, setCandidateCount] = useState<number | null>(null);
  const [rationale, setRationale] = useState('');
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [seeded, setSeeded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!supabase || !scenario.trim()) return;
    setLoading(true); setError(null); setRan(false);
    try {
      // LIVE catalog only — this is what the shopper actually sees today.
      let q = supabase
        .from('products')
        .select('id, name, brand, price, image_url, primary_image_url, haiku_context, gender, type')
        .eq('is_active', true)
        .not('image_url', 'is', null)
        .limit(400);
      if (gender === 'male') q = q.or('gender.eq.male,gender.eq.unisex');
      else if (gender === 'female') q = q.or('gender.eq.female,gender.eq.unisex');
      const { data } = await q;

      const mapped = ((data ?? []) as Array<PickedProduct & { haiku_context?: string | null; type?: string | null; gender?: string | null }>)
        .map(p => ({ ...p, role_tag: roleForProduct(p.type ?? null, p.name) }));
      setById(new Map(mapped.map(p => [p.id, p])));
      setCandidateCount(mapped.length);

      const payload = mapped.map(c => ({
        id: c.id, name: c.name ?? '', brand: c.brand, price: c.price,
        role: c.role_tag, context: (c as { haiku_context?: string | null }).haiku_context ?? null,
        gender: c.gender ?? null,
      }));
      const result = await suggestOutfit(scenario, gender, payload);
      setOutfit({ ...EMPTY, ...result.outfit });
      setRationale(result.rationale);
      setRan(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setLoading(false);
    }
  }, [scenario, gender]);

  const seedGap = useCallback(async (slotLabel: string) => {
    if (!supabase || !scenario.trim()) return;
    const term = `${scenario.trim()} ${slotLabel}`.toLowerCase();
    const { error: e } = await supabase.from('seed_targets')
      .insert({ term, kind: 'scenario', status: 'approved', priority: 60 });
    if (!e) setSeeded(prev => new Set(prev).add(slotLabel));
  }, [scenario]);

  const visibleSlots = useMemo(
    () => (gender === 'male' ? STYLIST_SLOTS.filter(s => s.key !== 'dresses') : STYLIST_SLOTS),
    [gender],
  );

  return (
    <div className="admin-page" style={{ padding: 24, maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/admin/seeding" style={{ color: '#9aa0a6', textDecoration: 'none' }}>← Seeding</Link>
        <h1 style={{ margin: 0 }}>Simulate coverage</h1>
      </div>
      <p style={{ color: '#9aa0a6', marginTop: 4 }}>
        Runs the real stylist against today’s <strong>live</strong> catalog. Empty slots are gaps you can seed.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0' }}>
        <input placeholder="Scenario — e.g. beach trip in Tulum" value={scenario}
          onChange={e => setScenario(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void run(); }}
          style={{ flex: '1 1 320px', minWidth: 240 }} />
        <select value={gender} onChange={e => setGender(e.target.value)}>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="unknown">Unspecified</option>
        </select>
        <button className="admin-btn" disabled={loading || !scenario.trim()} onClick={() => void run()}>
          {loading ? 'Styling…' : 'Simulate'}
        </button>
      </div>

      {error && <div style={{ color: '#ea4335', margin: '8px 0' }}>{error}</div>}

      {ran && (
        <>
          <div style={{ color: '#9aa0a6', fontSize: 13, marginBottom: 10 }}>
            {candidateCount} live candidates · {rationale || 'no rationale'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {visibleSlots.map(slot => {
              const id = outfit[slot.key as keyof StylistOutfit];
              const product = id ? byId.get(id) : null;
              const isGap = !product;
              return (
                <div key={slot.key} style={{ border: `1px solid ${isGap ? '#ea4335' : '#2a2a2a'}`, borderRadius: 10, padding: 10, minHeight: 150 }}>
                  <div style={{ fontSize: 12, color: '#9aa0a6', marginBottom: 6 }}>{slot.label}</div>
                  {product ? (
                    <div>
                      <img src={product.primary_image_url || product.image_url || ''} alt=""
                        style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6 }} />
                      <div style={{ fontSize: 12, marginTop: 6 }}>{product.brand}</div>
                      <div style={{ fontSize: 12, color: '#9aa0a6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 120, gap: 8 }}>
                      <span style={{ color: '#ea4335', fontSize: 13 }}>⚑ gap</span>
                      <button className="admin-btn-sm" disabled={seeded.has(slot.label)} onClick={() => void seedGap(slot.label)}>
                        {seeded.has(slot.label) ? 'Seeded ✓' : 'Seed this'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

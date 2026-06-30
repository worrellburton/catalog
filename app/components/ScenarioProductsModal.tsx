// ScenarioProductsModal — "all products available for this scenario", in-page.
//
// A styling scenario is paused (it never runs as paid demand), so it has no
// seed_target_id-tagged products — the /admin/data products view would be empty.
// Instead we show what the LIVE catalog actually offers for the scenario: the
// per-slot occasion-aware candidates (style_slot_search), grouped by garment.
// Pure retrieval — no Claude, no cost. Slots with nothing are flagged as gaps.

import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

const SLOT_LABEL: Record<string, string> = { hats: 'Hats', jackets: 'Jackets', tops: 'Tops', dresses: 'Dresses', bottoms: 'Bottoms', shoes: 'Shoes' };
const SLOT_NOUN: Record<string, string> = { hats: 'hat', jackets: 'jacket', tops: 'shirt', dresses: 'dress', bottoms: 'pants', shoes: 'shoes' };

interface Product { id: string; name: string; brand: string | null; price: string | null; image: string | null; url: string | null; }

export interface ProductsScenario {
  term: string;
  intent: Record<string, unknown> | null;
}

export default function ScenarioProductsModal({ scenario, onClose }: { scenario: ProductsScenario; onClose: () => void }) {
  const intent = (scenario.intent ?? {}) as Record<string, unknown>;
  const occasion = String(intent.occasion ?? scenario.term);
  const gender = String(intent.gender ?? '').toLowerCase();
  const filterGender = gender === 'male' || gender === 'female' ? gender : null;
  const slots = (Array.isArray(intent.slots) ? intent.slots as string[] : []).filter(s => SLOT_NOUN[s]);

  const [loading, setLoading] = useState(true);
  const [bySlot, setBySlot] = useState<Record<string, Product[]>>({});

  useEffect(() => {
    if (!supabase || slots.length === 0) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      const out: Record<string, Product[]> = {};
      for (const slot of slots) {
        const { data } = await supabase.rpc('style_slot_search', { p_query: `${occasion} ${SLOT_NOUN[slot]}`, p_k: 24, p_gender: filterGender });
        out[slot] = ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
          id: String(r.product_id), name: String(r.product_name ?? ''), brand: (r.product_brand as string) ?? null,
          price: (r.product_price as string) ?? null, image: (r.product_image_url as string) ?? null, url: (r.product_url as string) ?? null,
        }));
      }
      if (!cancelled) { setBySlot(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = Object.values(bySlot).reduce((n, a) => n + a.length, 0);

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal admin-modal-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column', colorScheme: 'light' }}>
        <div className="admin-modal-header">
          <h3>Available products · {scenario.term}</h3>
          <button className="admin-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="admin-modal-body" style={{ overflow: 'auto' }}>
          <p className="admin-cell-muted" style={{ marginTop: 0, fontSize: 13 }}>
            What the live catalog stocks for this scenario{filterGender ? ` (${filterGender})` : ''}, by garment. {!loading && `${total} total.`}
          </p>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160, gap: 12 }}>
              <span className="admin-spinner" style={{ width: 26, height: 26 }} />
              <span className="admin-cell-muted" style={{ fontSize: 13 }}>Loading catalog…</span>
            </div>
          )}

          {!loading && slots.map(slot => {
            const items = bySlot[slot] ?? [];
            return (
              <div key={slot} style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                  {SLOT_LABEL[slot] ?? slot} <span className="admin-cell-muted">· {items.length}</span>
                  {items.length === 0 && <span className="admin-status-warning" style={{ marginLeft: 8, fontSize: 12 }}>gap — nothing in catalog</span>}
                </div>
                {items.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                    {items.map(p => (
                      <a key={p.id} href={p.url ?? '#'} target="_blank" rel="noreferrer" className="admin-detail-card" style={{ padding: 8, textDecoration: 'none', color: 'inherit' }}>
                        {p.image
                          ? <img src={p.image} alt={p.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 6, background: '#f2f2f2' }} />
                          : <div style={{ aspectRatio: '3/4', background: '#f2f2f2', borderRadius: 6 }} />}
                        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{p.brand}</div>
                        <div style={{ fontSize: 12, color: '#555', lineHeight: 1.3 }}>{p.name}</div>
                        {p.price && <div style={{ fontSize: 12, marginTop: 2 }}>{p.price}</div>}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!loading && slots.length === 0 && (
            <p className="admin-cell-muted">This scenario has no garment slots in its intent.</p>
          )}
        </div>
      </div>
    </div>
  );
}

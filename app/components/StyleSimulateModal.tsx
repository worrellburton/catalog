// StyleSimulateModal — the Style Up simulation cockpit for one scenario.
//
// Pick a stylist persona + a user (or the scenario's default gender), run the
// standalone `style-engine` over the LIVE catalog, and see the outfit it
// assembles per slot — with the GAPS it couldn't fill surfaced as one-click
// "seed this gap" demand. The result is persisted to seed_targets.last_result
// so it survives a reload. Used from /admin/seeding → Styling tab.

import { useCallback, useState } from 'react';
import { supabase } from '~/utils/supabase';

export interface SimStylist { id: string; name: string; specialty: string | null; source_mode: string; }
export interface SimUser { id: string; name: string; gender: string | null; }
export interface SimScenario {
  id: string;
  term: string;
  intent: Record<string, unknown> | null;
  last_result: Record<string, unknown> | null;
}

const SLOT_LABEL: Record<string, string> = { hats: 'Hat', jackets: 'Jacket', tops: 'Top', dresses: 'Dress', bottoms: 'Bottoms', shoes: 'Shoes' };
const SLOT_NOUN: Record<string, string> = { hats: 'hat', jackets: 'jacket', tops: 'shirt', dresses: 'dress', bottoms: 'pants', shoes: 'shoes' };

interface Ref { id: string; name: string; brand: string | null; price: string | null; image: string | null; url: string | null; }
interface OutfitSet { outfit: Record<string, Ref | null>; gaps: string[]; rationale: string; }
interface Result {
  source: string; gender: string; stylist: string; slots: string[];
  sets: OutfitSet[]; gaps: string[]; candidateCounts: Record<string, number>;
  model?: string; cost?: number; usage?: { input_tokens: number; output_tokens: number } | null;
}

// Operator-selectable assembly models (cost vs quality). Sonnet is the default.
const MODELS: { id: string; label: string }[] = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (balanced)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (cheapest)' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 (sharpest)' },
];
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;

function SlotCard({ slot, ref }: { slot: string; ref: Ref }) {
  return (
    <a href={ref.url ?? '#'} target="_blank" rel="noreferrer" className="admin-detail-card" style={{ padding: 8, textDecoration: 'none', color: 'inherit' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5, color: '#888', marginBottom: 6 }}>{SLOT_LABEL[slot] ?? slot}</div>
      {ref.image
        ? <img src={ref.image} alt={ref.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 6, background: '#f2f2f2' }} />
        : <div style={{ aspectRatio: '3/4', background: '#f2f2f2', borderRadius: 6 }} />}
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{ref.brand}</div>
      <div style={{ fontSize: 12, color: '#555', lineHeight: 1.3 }}>{ref.name}</div>
      {ref.price && <div style={{ fontSize: 12, marginTop: 2 }}>{ref.price}</div>}
    </a>
  );
}

export default function StyleSimulateModal({ scenario, stylists, users, spend, onClose, onChanged }: {
  scenario: SimScenario; stylists: SimStylist[]; users: SimUser[];
  spend?: { total: number; runs: number };
  onClose: () => void; onChanged: () => void;
}) {
  const [stylistId, setStylistId] = useState(stylists.find(s => s.source_mode === 'catalog')?.id ?? stylists[0]?.id ?? '');
  const [userId, setUserId] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>((scenario.last_result as unknown as Result) ?? null);
  const [seeded, setSeeded] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const intent = (scenario.intent ?? {}) as Record<string, unknown>;
  const summary = [intent.gender, intent.formality != null ? `formality ${intent.formality}` : null, intent.season,
    Array.isArray(intent.slots) ? (intent.slots as string[]).join('/') : null].filter(Boolean).join(' · ');

  const run = useCallback(async () => {
    if (!supabase) return;
    setRunning(true); setErr(null);
    const { data, error } = await supabase.functions.invoke('style-engine', {
      body: { scenario_text: scenario.term, intent: scenario.intent ?? {}, stylist_id: stylistId, shopper_user_id: userId || null, model },
    });
    if (error || !data?.success) { setErr(error?.message || data?.error || 'Simulation failed'); setRunning(false); return; }
    setResult(data as Result);
    await supabase.from('seed_targets').update({ last_result: data }).eq('id', scenario.id);
    setSeeded(new Set());
    setRunning(false);
    onChanged();
  }, [scenario.id, scenario.term, scenario.intent, stylistId, userId, model, onChanged]);

  // A gap → a real demand target (kind='manual' → Searches tab, approved → the
  // loop fetches it). Default to a SHORT, general garment term: short (<4 words)
  // is a cheap DIRECT SerpAPI search (skips Claude brainstorm), and the fetched
  // pieces are reusable across every scenario (occasion-fit is added later by
  // enrich-occasions, not the search term). Editable so the operator can tighten
  // relevance ("sun hat", "straw hat") or keep it broad ("hat").
  const seedGap = useCallback(async (slot: string) => {
    if (!supabase) return;
    const noun = SLOT_NOUN[slot] ?? slot;
    const entered = window.prompt(
      `Seed which products? Keep it short (1-3 words) so it's a cheap search and the pieces are reusable. e.g. "${noun}", "summer ${noun}".`,
      noun,
    );
    const term = (entered ?? '').trim().toLowerCase();
    if (!term) return;
    const { error } = await supabase.from('seed_targets').insert({ term, kind: 'manual', status: 'approved', priority: 60 });
    // 23505 = already in the queue; treat as success (it's seeded either way).
    if (!error || error.code === '23505') { setSeeded(prev => new Set(prev).add(slot)); onChanged(); }
  }, [onChanged]);

  const slots = result?.slots ?? (Array.isArray(intent.slots) ? intent.slots as string[] : []);

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal admin-modal-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column', colorScheme: 'light' }}>
        <div className="admin-modal-header">
          <h3>Simulate · {scenario.term}</h3>
          <button className="admin-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="admin-modal-body" style={{ overflow: 'auto' }}>
          {summary && <p className="admin-cell-muted" style={{ marginTop: 0 }}>{summary}</p>}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              Stylist
              <select className="admin-date-input" value={stylistId} onChange={e => setStylistId(e.target.value)}>
                {stylists.map(s => <option key={s.id} value={s.id}>{s.name}{s.specialty ? ` — ${s.specialty}` : ''}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              User
              <select className="admin-date-input" value={userId} onChange={e => setUserId(e.target.value)}>
                <option value="">Scenario default ({String(intent.gender ?? 'any')})</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.gender ? ` (${u.gender})` : ''}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              Model
              <select className="admin-date-input" value={model} onChange={e => setModel(e.target.value)}>
                {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <button className="admin-btn admin-btn-primary" disabled={running || !stylistId} onClick={() => void run()}>
              {running ? 'Simulating…' : result ? 'Re-simulate' : 'Run simulation'}
            </button>
          </div>

          {spend && (
            <p className="admin-cell-muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
              Total simulation spend: <strong>{usd(spend.total)}</strong> over {spend.runs} run{spend.runs === 1 ? '' : 's'}
            </p>
          )}

          {err && <div className="admin-status-warning" style={{ fontSize: 13, marginBottom: 10 }}>{err}</div>}

          {result && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, fontSize: 13, flexWrap: 'wrap' }}>
                <span className="admin-cell-muted">{result.stylist} · {result.gender}</span>
                <span className={`admin-status-dot admin-status-dot--${result.source === 'claude' ? 'live' : 'inactive'}`} />
                <span>{result.source === 'claude' ? 'Claude assembled' : 'heuristic (no AI credits)'}</span>
                {result.source === 'claude' && typeof result.cost === 'number' && (
                  <span className="admin-cell-muted">
                    · this run <strong style={{ color: '#0d9488' }}>{usd(result.cost)}</strong>
                    {result.usage ? ` (${result.model?.replace('claude-', '')}, ${result.usage.input_tokens}→${result.usage.output_tokens} tok)` : ''}
                  </span>
                )}
                <span className="admin-cell-muted">· {result.sets?.length ?? 0} look{(result.sets?.length ?? 0) === 1 ? '' : 's'} to choose from</span>
              </div>

              {(result.sets ?? []).map((set, i) => (
                <div key={i} style={{ marginBottom: 18 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Look {i + 1}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                    {slots.map(slot => {
                      const ref = set.outfit?.[slot];
                      if (ref) return <SlotCard key={slot} slot={slot} ref={ref} />;
                      return (
                        <div key={slot} className="admin-detail-card" style={{ padding: 8, border: '1px dashed #ddd' }}>
                          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5, color: '#888', marginBottom: 6 }}>{SLOT_LABEL[slot] ?? slot}</div>
                          <div style={{ aspectRatio: '3/4', background: '#fafafa', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 12 }}>—</div>
                        </div>
                      );
                    })}
                  </div>
                  {set.rationale && <p style={{ margin: '6px 0 0', fontStyle: 'italic', fontSize: 13 }}>{set.rationale}</p>}
                </div>
              ))}

              {result.gaps?.length > 0 && (
                <div className="admin-detail-card" style={{ padding: 12, borderColor: '#f0c2bd', background: '#fff8f7' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#c0392b' }}>
                    Missing from catalog ({result.gaps.length}) — seed to fill
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {result.gaps.map(slot => (
                      <button key={slot} className="admin-btn admin-btn-secondary admin-row-promote"
                        disabled={seeded.has(slot)} onClick={() => void seedGap(slot)}>
                        {seeded.has(slot) ? `✓ seeding ${SLOT_LABEL[slot] ?? slot}` : `Seed ${SLOT_LABEL[slot] ?? slot}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {!result && !running && (
            <p className="admin-cell-muted">Pick a stylist and a user, then run the simulation to see the outfit this scenario produces from the live catalog.</p>
          )}
        </div>
      </div>
    </div>
  );
}

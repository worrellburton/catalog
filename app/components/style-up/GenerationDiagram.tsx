import { roleTagFromName } from '~/services/product-roles';
import type { AdminLook } from '~/services/style-up';
import type { UserGeneration, UserUpload } from '~/services/user-generations';
import { fmtTime, fmtElapsed } from './admin-format';

// ── Generation graph — everything about one render, in the same light
// Input → Model → Output node style as the Data page's Polish graph. ──
const gCard = { border: '1px solid #cbd5e1', borderRadius: 12, padding: 12, background: '#fff', display: 'flex', flexDirection: 'column' as const, gap: 8 };
const gLabel = { fontSize: 10, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 700 };
const gKv = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: '#64748b' };
const gKvVal = { fontWeight: 600, color: '#0f172a', textAlign: 'right' as const };
const gArrow = { fontSize: 28, color: '#cbd5e1', textAlign: 'center' as const, lineHeight: 1 };

// Head-to-toe display order for the pieces row (hat → jacket → top →
// bottoms → shoes, accessories last). New generations are stored in this
// order already; the name-based sort covers renders from before that.
const SLOT_ORDER: Record<string, number> = { Hat: 0, Sunglasses: 1, Jacket: 2, Top: 3, Dress: 3, Pants: 4, Shoes: 5, Jewelry: 6, Bag: 7, Accessory: 8 };
function sortHeadToToe<T extends { name?: string }>(pieces: T[]): T[] {
  return [...pieces].sort((a, b) =>
    (SLOT_ORDER[roleTagFromName(a.name ?? null) ?? ''] ?? 9) - (SLOT_ORDER[roleTagFromName(b.name ?? null) ?? ''] ?? 9));
}

export default function GenerationDiagram({ look, gen, uploads }: { look: AdminLook; gen: UserGeneration | null; uploads: UserUpload[] }) {
  const status = gen?.status ?? look.status;
  const videoUrl = gen?.video_url ?? look.videoUrl;
  const pieces = sortHeadToToe(look.products);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1.2fr auto 1fr', gap: 12, alignItems: 'start' }}>
      {/* Input — the shopper + the pieces going into the render. */}
      <div style={gCard}>
        <div style={gLabel}>Input · Shopper + pieces</div>
        <div style={gKv}><span>Shopper</span><span style={gKvVal}>{look.shopper.name}</span></div>
        <div style={gKv}><span>Height</span><span style={gKvVal}>{gen?.height_label ?? '—'}</span></div>
        <div style={gKv}><span>Weight</span><span style={gKvVal}>{gen?.weight_label ?? '—'}</span></div>
        <div style={gKv}><span>Age</span><span style={gKvVal}>{gen?.age_label ?? '—'}</span></div>
        <div style={gKv}><span>Style</span><span style={gKvVal}>{gen?.style ?? '—'}</span></div>
        <div style={{ ...gLabel, marginTop: 4 }}>Shopper photos ({uploads.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {uploads.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>(none recorded)</span>}
          {uploads.map(u => (
            <span key={u.id} title="Photo of the shopper sent to the model"
              style={{ width: 40, height: 50, borderRadius: 6, overflow: 'hidden', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
              <img src={u.public_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </span>
          ))}
        </div>
        <div style={{ ...gLabel, marginTop: 4 }}>Pieces ({pieces.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {pieces.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>(none recorded)</span>}
          {pieces.map((p, i) => (
            <span key={p.id || i} title={[p.brand, p.name].filter(Boolean).join(' · ')}
              style={{ width: 40, height: 50, borderRadius: 6, overflow: 'hidden', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
              {p.image && <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            </span>
          ))}
        </div>
      </div>
      <div style={gArrow}>→</div>
      {/* Model — engine, the literal prompt, and run metadata. */}
      <div style={{ ...gCard, border: '1px solid #ddd6fe', background: '#faf5ff' }}>
        <div style={{ ...gLabel, color: '#7c3aed' }}>Model · Look generation (photos + pieces → video)</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {gen?.veo_model ?? 'veo'}{gen?.model ? ` (${gen.model})` : ''}
        </div>
        <div
          title="The literal prompt sent for this generation."
          style={{
            fontSize: 11, color: '#475569', lineHeight: 1.45, padding: 8,
            background: '#fff', borderRadius: 6, border: '1px solid #ede9fe',
            whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto',
          }}
        >
          {gen?.prompt || '(prompt unavailable)'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: '#64748b' }}>
          <span>duration: {gen ? `${gen.duration_seconds}s` : '—'}</span>
          <span>started: {fmtTime(gen?.created_at ?? look.createdAt)}</span>
          <span>took: {fmtElapsed(gen?.created_at ?? null, gen?.completed_at ?? null)}</span>
          {gen?.fal_request_id && <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>req: {gen.fal_request_id.slice(0, 12)}…</span>}
        </div>
      </div>
      <div style={gArrow}>→</div>
      {/* Output — the finished look, or why it failed. */}
      <div style={gCard}>
        <div style={gLabel}>Output · {status === 'done' ? 'Generated look' : status === 'failed' ? 'Failed' : 'Rendering…'}</div>
        {status === 'failed' && gen?.error ? (
          <div style={{ fontSize: 11, color: '#b91c1c', lineHeight: 1.45, padding: 8, background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca', whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
            {gen.error}
          </div>
        ) : videoUrl ? (
          <video src={videoUrl} muted loop playsInline controls style={{ width: '100%', aspectRatio: '9 / 16', objectFit: 'contain', background: '#f1f5f9', borderRadius: 8 }} />
        ) : (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>(no video yet)</div>
        )}
      </div>
    </div>
  );
}

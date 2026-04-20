import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getModerationQueue,
  setAdLive,
  rejectAd,
  regenerateAd,
  deleteProductAd,
  type ProductAd,
} from '~/services/product-ads';

type Action = 'approved' | 'rejected' | 'regenerated' | 'deleted';

export default function AdminModeration() {
  const [queue, setQueue] = useState<ProductAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<{ id: string; action: Action } | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getModerationQueue();
    setQueue(data);
    setFocusIdx(0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = useCallback((id: string, action: Action) => {
    setLastAction({ id, action });
    setTimeout(() => setLastAction(null), 2000);
  }, []);

  const approveCurrent = useCallback(async () => {
    const ad = queue[focusIdx];
    if (!ad || busyId) return;
    setBusyId(ad.id);
    const { error } = await setAdLive(ad.id);
    setBusyId(null);
    if (!error) {
      setQueue(prev => prev.filter(a => a.id !== ad.id));
      setFocusIdx(i => Math.min(i, queue.length - 2));
      showToast(ad.id, 'approved');
    }
  }, [queue, focusIdx, busyId, showToast]);

  const deleteCurrent = useCallback(async () => {
    const ad = queue[focusIdx];
    if (!ad || busyId) return;
    setBusyId(ad.id);
    const { error } = await deleteProductAd(ad.id);
    setBusyId(null);
    if (!error) {
      setQueue(prev => prev.filter(a => a.id !== ad.id));
      setFocusIdx(i => Math.min(i, queue.length - 2));
      showToast(ad.id, 'deleted');
    }
  }, [queue, focusIdx, busyId, showToast]);

  // Regenerate modal — lets the admin tweak the prompt before kicking off a
  // new video. Shown when the user clicks the regenerate button or hits ↑.
  const [regenPrompt, setRegenPrompt] = useState<{ adId: string; prompt: string | null; extra: string } | null>(null);

  const openRegenerate = useCallback(() => {
    const ad = queue[focusIdx];
    if (!ad || busyId) return;
    setRegenPrompt({ adId: ad.id, prompt: ad.prompt, extra: ad.prompt_extra || '' });
  }, [queue, focusIdx, busyId]);

  const submitRegenerate = useCallback(async (extra: string) => {
    if (!regenPrompt) return;
    const adId = regenPrompt.adId;
    setBusyId(adId);
    const { error } = await regenerateAd(adId, extra);
    setBusyId(null);
    setRegenPrompt(null);
    if (!error) {
      setQueue(prev => prev.filter(a => a.id !== adId));
      setFocusIdx(i => Math.min(i, queue.length - 2));
      showToast(adId, 'regenerated');
    }
  }, [regenPrompt, queue.length, showToast]);

  const regenerateCurrent = useCallback(() => {
    openRegenerate();
  }, [openRegenerate]);

  const rejectCurrent = useCallback(async () => {
    const ad = queue[focusIdx];
    if (!ad || busyId) return;
    setBusyId(ad.id);
    const { error } = await rejectAd(ad.id);
    setBusyId(null);
    if (!error) {
      setQueue(prev => prev.filter(a => a.id !== ad.id));
      setFocusIdx(i => Math.min(i, queue.length - 2));
      showToast(ad.id, 'rejected');
    }
  }, [queue, focusIdx, busyId, showToast]);

  // Scroll focused card into view
  useEffect(() => {
    const el = cardRefs.current[focusIdx];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [focusIdx, queue.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (queue.length === 0) return;
      // Ignore when typing
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowRight') {
        if (e.shiftKey) {
          setFocusIdx(i => Math.min(i + 1, queue.length - 1));
        } else {
          e.preventDefault();
          approveCurrent();
        }
      } else if (e.key === 'ArrowLeft') {
        if (e.shiftKey) {
          setFocusIdx(i => Math.max(i - 1, 0));
        } else {
          e.preventDefault();
          deleteCurrent();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        regenerateCurrent();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        rejectCurrent();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [queue.length, approveCurrent, deleteCurrent, regenerateCurrent, rejectCurrent]);

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Moderation Queue</h1>
          <p className="admin-page-subtitle">
            Review newly-generated ads before they go live. Use arrow keys: <kbd style={kbd}>←</kbd> delete, <kbd style={kbd}>→</kbd> approve, <kbd style={kbd}>↑</kbd> regenerate, <kbd style={kbd}>↓</kbd> reject. Hold <kbd style={kbd}>Shift</kbd> + <kbd style={kbd}>←/→</kbd> to navigate without acting.
          </p>
        </div>
        <button className="admin-btn admin-btn-secondary" onClick={load} disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, padding: '10px 0', marginBottom: 12, alignItems: 'baseline' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{queue.length}</span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Awaiting review</span>
        </div>
        {queue.length > 0 && (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Viewing <strong>{focusIdx + 1}</strong> of {queue.length}
          </div>
        )}
      </div>

      {lastAction && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          background: lastAction.action === 'approved' ? '#ecfdf5' : '#fef2f2',
          border: `1px solid ${lastAction.action === 'approved' ? '#a7f3d0' : '#fecaca'}`,
          color: lastAction.action === 'approved' ? '#047857' : '#b91c1c',
          fontSize: 12, fontWeight: 600,
        }}>
          {lastAction.action === 'approved' && '✓ Approved — now live in the feed'}
          {lastAction.action === 'rejected' && '✕ Rejected — paused and hidden from feed'}
          {lastAction.action === 'regenerated' && '↻ Regenerating — new video queued'}
          {lastAction.action === 'deleted' && '🗑 Deleted'}
        </div>
      )}

      {loading ? (
        <div className="admin-empty">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="admin-empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 4 }}>Nothing to review</div>
          <div style={{ fontSize: 12, color: '#888' }}>All finished ads have been reviewed.</div>
        </div>
      ) : (
        <div
          ref={rowRef}
          style={{
            display: 'flex',
            gap: 20,
            overflowX: 'auto',
            overflowY: 'hidden',
            padding: '8px 4px 20px',
            scrollSnapType: 'x mandatory',
          }}
        >
          {queue.map((ad, idx) => {
            const isFocus = idx === focusIdx;
            return (
              <div
                ref={el => { cardRefs.current[idx] = el; }}
                key={ad.id}
                onClick={() => setFocusIdx(idx)}
                style={{
                  flex: '0 0 300px',
                  scrollSnapAlign: 'center',
                  background: '#fff',
                  border: '1px solid',
                  borderColor: isFocus ? '#3b82f6' : '#e5e7eb',
                  boxShadow: isFocus ? '0 0 0 3px rgba(59,130,246,0.2)' : 'none',
                  borderRadius: 12,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: busyId === ad.id ? 0.5 : 1,
                  transition: 'opacity 0.2s, border-color 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                }}
              >
                {/* Video preview */}
                <div style={{
                  aspectRatio: '9 / 16',
                  background: '#000',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {ad.video_url && (
                    <video
                      src={ad.video_url}
                      autoPlay muted loop playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                  <div style={{
                    position: 'absolute', top: 8, left: 8,
                    padding: '3px 8px', borderRadius: 4,
                    background: 'rgba(0,0,0,0.6)', color: '#fff',
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>
                    {ad.style.replace(/_/g, ' ')}
                  </div>
                </div>

                {/* Product photo (larger) — links to product page */}
                {ad.product?.image_url && (() => {
                  const productHref = ad.affiliate_url || ad.product?.url || null;
                  const wrapperStyle = {
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 12, background: '#f9fafb', borderBottom: '1px solid #f5f5f5',
                  } as const;
                  const img = (
                    <img
                      src={ad.product.image_url}
                      alt={ad.product.name || ''}
                      style={{
                        maxWidth: '100%', maxHeight: 140,
                        objectFit: 'contain', borderRadius: 6,
                      }}
                    />
                  );
                  if (productHref) {
                    return (
                      <a
                        href={productHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open product page"
                        style={{ ...wrapperStyle, cursor: 'pointer', textDecoration: 'none' }}
                      >
                        {img}
                      </a>
                    );
                  }
                  return <div style={wrapperStyle}>{img}</div>;
                })()}

                {/* Product info — name links to product page */}
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {ad.product?.brand || '—'}
                  </div>
                  {(() => {
                    const productHref = ad.affiliate_url || ad.product?.url || null;
                    const nameStyle = { fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const };
                    if (productHref) {
                      return (
                        <a
                          href={productHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ ...nameStyle, display: 'block', textDecoration: 'none' }}
                        >
                          {ad.product?.name || 'Unnamed'}
                        </a>
                      );
                    }
                    return <div style={nameStyle}>{ad.product?.name || 'Unnamed'}</div>;
                  })()}
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {ad.product?.price || ''}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ padding: 8, display: 'flex', gap: 6 }}>
                  <button
                    className="admin-btn admin-btn-primary"
                    style={{ flex: 1, fontSize: 12, padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    disabled={busyId === ad.id}
                    onClick={(e) => { e.stopPropagation(); setFocusIdx(idx); approveCurrent(); }}
                    title="Approve (→)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Approve
                  </button>
                  <button
                    className="admin-btn admin-btn-secondary"
                    style={{ fontSize: 12, padding: '6px 10px', color: '#b91c1c' }}
                    disabled={busyId === ad.id}
                    onClick={(e) => { e.stopPropagation(); setFocusIdx(idx); rejectCurrent(); }}
                    title="Reject (↓)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                  <button
                    className="admin-btn admin-btn-secondary"
                    style={{ fontSize: 12, padding: '6px 10px' }}
                    disabled={busyId === ad.id}
                    onClick={(e) => { e.stopPropagation(); setFocusIdx(idx); regenerateCurrent(); }}
                    title="Regenerate (↑)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                  </button>
                  <button
                    className="admin-btn admin-btn-secondary"
                    style={{ fontSize: 12, padding: '6px 10px', color: '#64748b' }}
                    disabled={busyId === ad.id}
                    onClick={(e) => { e.stopPropagation(); setFocusIdx(idx); deleteCurrent(); }}
                    title="Delete (←)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {regenPrompt && (
        <RegenerateModal
          prompt={regenPrompt.prompt}
          initialExtra={regenPrompt.extra}
          onCancel={() => setRegenPrompt(null)}
          onSubmit={submitRegenerate}
          busy={!!busyId}
        />
      )}
    </div>
  );
}

function RegenerateModal({
  prompt,
  initialExtra,
  onCancel,
  onSubmit,
  busy,
}: {
  prompt: string | null;
  initialExtra: string;
  onCancel: () => void;
  onSubmit: (extra: string) => void;
  busy: boolean;
}) {
  const [extra, setExtra] = useState(initialExtra);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(extra);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [extra, onCancel, onSubmit]);

  return (
    <div
      className="admin-modal-overlay"
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        className="admin-modal"
        style={{ width: 620, maxWidth: '92vw', padding: 24, background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Regenerate video</h2>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#888' }}>
          Add guidance for the next attempt. It will be appended to the auto-generated prompt.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
            Previous prompt
          </label>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              padding: '10px 12px',
              background: '#f5f7fb',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              color: '#334155',
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {prompt || <em style={{ color: '#94a3b8' }}>No prompt recorded for the previous run.</em>}
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
            Additional instructions (appended)
          </label>
          <textarea
            autoFocus
            value={extra}
            onChange={e => setExtra(e.target.value)}
            rows={4}
            placeholder='e.g. "Keep the model looking at camera. Sunset lighting. No text overlays."'
            style={{
              width: '100%',
              fontSize: 13,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid #ddd',
              resize: 'vertical',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            Tip: ⌘/Ctrl+Enter to regenerate, Esc to cancel.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="admin-btn admin-btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="admin-btn admin-btn-primary"
            onClick={() => onSubmit(extra)}
            disabled={busy}
          >
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
}

const kbd: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  fontSize: 10,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  background: '#f3f4f6',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  color: '#374151',
  margin: '0 2px',
};

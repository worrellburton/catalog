import { useState } from 'react';
import { usePresentBroadcaster } from '~/hooks/usePresentBroadcaster';

/*
 * Temporary dev harness for the /present/ live-mirror feature.
 *
 * Phase 2 needs *something* on the network for /present/<slug> to
 * subscribe to. The eventual home for these controls is Phase 10's
 * presenter HUD (start/stop broadcast, route allowlist, etc.). This
 * route is the throwaway that lets us verify Phase 1 + Phase 2 end-
 * to-end: open /present-test in one tab, /present/<slug> in another,
 * and watch the heartbeats flow.
 */
export default function PresentTest() {
  const [slug, setSlug] = useState('robert-burton');
  const [enabled, setEnabled] = useState(true);
  const [counter, setCounter] = useState(0);
  const { isConnected, broadcast } = usePresentBroadcaster({ slug, enabled });

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#070707',
      color: '#fff',
      fontFamily: 'Inter, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 460,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 28,
      }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.22em',
          color: 'rgba(255,255,255,0.5)',
          marginBottom: 8,
        }}>
          PRESENT · DEV HARNESS
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, marginBottom: 18 }}>
          Broadcast tester
        </h1>

        <label style={labelStyle}>Slug</label>
        <input
          value={slug}
          onChange={e => setSlug(e.target.value)}
          style={inputStyle}
          spellCheck={false}
        />

        <label style={{ ...labelStyle, marginTop: 16 }}>Status</label>
        <div style={{
          fontSize: 13,
          color: isConnected ? '#4ade80' : 'rgba(255,255,255,0.6)',
          fontFamily: 'ui-monospace, monospace',
        }}>
          {isConnected ? 'connected · heartbeat 1Hz' : 'connecting…'}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button
            onClick={() => setEnabled(v => !v)}
            style={{ ...btnStyle, ...(enabled ? btnDangerStyle : btnPrimaryStyle) }}
          >
            {enabled ? 'Stop broadcasting' : 'Start broadcasting'}
          </button>
          <button
            onClick={() => {
              const seq = broadcast('heartbeat', { ts: Date.now(), manual: true, n: counter + 1 });
              if (seq != null) setCounter(c => c + 1);
            }}
            style={{ ...btnStyle, ...btnSecondaryStyle }}
            disabled={!isConnected}
          >
            Send manual ping ({counter})
          </button>
        </div>

        <div style={{
          marginTop: 22,
          padding: 12,
          borderRadius: 8,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.55)',
          lineHeight: 1.6,
        }}>
          Open <code style={{ color: '#a78bfa' }}>/present/{slug || '<slug>'}</code>{' '}
          in another tab (or device, or incognito) to watch the live feed.
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.42)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.03)',
  color: '#fff',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 8,
  border: 'none',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnPrimaryStyle: React.CSSProperties = {
  background: '#4ade80',
  color: '#022c11',
};

const btnDangerStyle: React.CSSProperties = {
  background: 'rgba(239,68,68,0.15)',
  color: '#fca5a5',
  border: '1px solid rgba(239,68,68,0.32)',
};

const btnSecondaryStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
};

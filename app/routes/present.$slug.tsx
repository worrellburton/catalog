import { useParams } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { usePresentSubscription } from '~/hooks/usePresentSubscription';

/*
 * Public live-mirror viewer at /present/<slug>.
 *
 * No auth gate, no Supabase login: the page subscribes anonymously
 * to the public broadcast channel `present:<slug>` (see
 * app/services/present.ts). All state arrives over the wire — the
 * viewer never fetches anything from the catalog DB itself, so
 * private data only appears on screen when the presenter chooses to
 * broadcast it.
 *
 * Phase 2 ships the stub shell: connection pill, latency, event
 * counter, and a JSON dump of the latest envelope. Phase 3 onward
 * fills in the real route/cursor/overlay rendering.
 */
export default function PresentViewer() {
  const params = useParams();
  const slug = params.slug ?? '';

  const { connection, latest, latencyMs, eventsReceived } = usePresentSubscription({ slug });

  // Tick a counter once a second so "last event Xs ago" stays fresh
  // even when the channel goes quiet.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const sinceLastMs = latest ? Math.max(0, now - latest.sentAt) : null;
  const stale = sinceLastMs !== null && sinceLastMs > 5000;

  return (
    <div style={pageStyle}>
      <div style={chromeStyle}>
        <div style={chromeLeftStyle}>
          <span style={badgeStyle}>PRESENT</span>
          <span style={slugStyle}>{slug || 'unset'}</span>
          <ConnectionPill state={connection} stale={stale} />
        </div>
        <div style={chromeRightStyle}>
          <Stat label="Latency" value={latencyMs == null ? '—' : `${latencyMs} ms`} />
          <Stat label="Events" value={eventsReceived.toString()} />
          <Stat
            label="Last"
            value={sinceLastMs == null ? '—' : `${(sinceLastMs / 1000).toFixed(1)}s ago`}
          />
        </div>
      </div>

      <main style={mainStyle}>
        {!latest ? (
          <div style={emptyStyle}>
            <div style={emptyTitleStyle}>Waiting for presenter…</div>
            <div style={emptySubStyle}>
              Channel <code style={codeStyle}>present:{slug}</code>
            </div>
          </div>
        ) : (
          <div style={payloadCardStyle}>
            <div style={payloadHeadStyle}>
              <span style={payloadTypeStyle}>{latest.type}</span>
              <span style={payloadSeqStyle}>#{latest.seq}</span>
            </div>
            <pre style={payloadJsonStyle}>{JSON.stringify(latest.payload, null, 2)}</pre>
          </div>
        )}
      </main>
    </div>
  );
}

function ConnectionPill({
  state,
  stale,
}: {
  state: ReturnType<typeof usePresentSubscription>['connection'];
  stale: boolean;
}) {
  const live = state === 'connected' && !stale;
  const dotColor =
    state === 'connected' ? (stale ? '#f59e0b' : '#4ade80') :
    state === 'connecting' ? '#facc15' :
    state === 'disconnected' ? '#ef4444' :
    'rgba(255,255,255,0.4)';
  const label =
    state === 'connected' ? (stale ? 'Idle' : 'Live') :
    state === 'connecting' ? 'Connecting' :
    state === 'disconnected' ? 'Offline' :
    'Idle';
  return (
    <span style={pillStyle}>
      <span
        style={{
          ...pillDotStyle,
          background: dotColor,
          boxShadow: live ? `0 0 10px ${dotColor}` : 'none',
        }}
      />
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={statStyle}>
      <span style={statLabelStyle}>{label}</span>
      <span style={statValueStyle}>{value}</span>
    </div>
  );
}

const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const pageStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#070707',
  color: '#fff',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 100,
};

const chromeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 24px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  background: 'rgba(0,0,0,0.4)',
  backdropFilter: 'blur(12px)',
};

const chromeLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

const chromeRightStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 22,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.22em',
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.18)',
  color: 'rgba(255,255,255,0.78)',
};

const slugStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 13,
  color: 'rgba(255,255,255,0.62)',
};

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 12px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.02)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'rgba(255,255,255,0.78)',
};

const pillDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  transition: 'background 0.3s ease, box-shadow 0.3s ease',
};

const statStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 2,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.42)',
};

const statValueStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 13,
  color: '#fff',
  fontVariantNumeric: 'tabular-nums',
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
  overflow: 'auto',
};

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  color: 'rgba(255,255,255,0.55)',
};

const emptyTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 500,
  marginBottom: 8,
};

const emptySubStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'rgba(255,255,255,0.4)',
};

const codeStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 12,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.7)',
};

const payloadCardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 720,
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  padding: 24,
};

const payloadHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 16,
};

const payloadTypeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#a78bfa',
};

const payloadSeqStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 11,
  color: 'rgba(255,255,255,0.4)',
};

const payloadJsonStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: FONT_MONO,
  fontSize: 12,
  lineHeight: 1.6,
  color: 'rgba(255,255,255,0.78)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

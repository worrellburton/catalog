import { useParams } from '@remix-run/react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { usePresentBroadcaster } from '~/hooks/usePresentBroadcaster';
import { usePresentCursorBroadcast } from '~/hooks/usePresentCursorBroadcast';
import { usePresentCursors } from '~/hooks/usePresentCursors';
import { usePresentInteractionBroadcast } from '~/hooks/usePresentInteractionBroadcast';
import { usePresentSubscription } from '~/hooks/usePresentSubscription';
import PresentClickRipples, { useClickRipples } from '~/components/PresentClickRipples';
import PresentRemoteCursors from '~/components/PresentRemoteCursors';
import {
  colorForId,
  defaultGuestName,
  getOrCreatePresentId,
  readPresentName,
  type ClickPayload,
  type HoverPayload,
  type PresentEnvelope,
  type PresentEventType,
  type RoutePayload,
  type ScrollPayload,
} from '~/services/present';

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
 * Phase 3 adds route reduction: the viewer now tracks the
 * presenter's current route and shows a styled "now showing" panel.
 * Phases 4-8 fill in scroll, cursor, overlay, search rendering on
 * top of the same envelope stream.
 */
export default function PresentViewer() {
  const params = useParams();
  const slug = params.slug ?? '';

  const [state, dispatch] = useReducer(presentReducer, initialState);

  // ── Guest identity ─────────────────────────────────────────────
  // Stable per-tab id, hashed color, name override from
  // localStorage (so the same person can pick a name once and keep
  // it across tabs/days). Defaults to "Guest XXXX" using a 4-char
  // signature of the id.
  const id = useMemo(() => getOrCreatePresentId(), []);
  const name = useMemo(() => readPresentName() ?? defaultGuestName(id), [id]);
  const color = useMemo(() => colorForId(id), [id]);

  // Bidirectional broadcaster: we both send our cursor and receive
  // everyone else's via the same channel.
  const { broadcast, isConnected } = usePresentBroadcaster({
    slug,
    enabled: true,
    // Guests don't need a heartbeat — the presenter side already
    // emits one and our subscription picks it up.
    heartbeatIntervalMs: 0,
  });

  const { ingest: ingestCursor, cursors } = usePresentCursors({
    selfId: id,
    enabled: true,
  });

  usePresentCursorBroadcast({
    broadcast,
    isConnected,
    id,
    name,
    color,
    role: 'guest',
    enabled: true,
  });

  // Guests also broadcast their clicks + hover, so the presenter
  // sees ripples + the viewer can show "guest clicked X".
  usePresentInteractionBroadcast({
    broadcast,
    isConnected,
    id,
    color,
    enabled: true,
  });

  // Click ripples — visible bloom at every received click, regardless
  // of who sent it (presenter or guest).
  const { ripples, pushClick } = useClickRipples();

  // Single onEnvelope: dispatch for state reducer + ingest for
  // cursor map + push for click ripples. Keeping it stable lets the
  // subscription resubscribe only when slug changes.
  const onEnvelope = useCallback(
    (env: PresentEnvelope) => {
      dispatch({ kind: 'envelope', env });
      ingestCursor(env);
      if (env.type === 'click') {
        pushClick(env.payload as ClickPayload);
      }
    },
    [ingestCursor, pushClick],
  );

  const { connection, latencyMs, eventsReceived } = usePresentSubscription({
    slug,
    onEnvelope,
  });

  // Tick once a second so "last event Xs ago" stays fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const lastEnv = state.eventsByType.heartbeat ?? state.lastAny;
  const sinceLastMs = lastEnv ? Math.max(0, now - lastEnv.sentAt) : null;
  const stale = sinceLastMs !== null && sinceLastMs > 5000;

  const activeScroll = state.lastScrollSelector
    ? state.scrollBySelector[state.lastScrollSelector] ?? null
    : null;

  return (
    <div style={pageStyle}>
      <div style={chromeStyle}>
        <div style={chromeLeftStyle}>
          <span style={badgeStyle}>PRESENT</span>
          <span style={slugStyle}>{slug || 'unset'}</span>
          <ConnectionPill state={connection} stale={stale} />
        </div>
        <div style={chromeRightStyle}>
          <Stat label="Hover" value={state.hoverId ?? '—'} mono />
          <Stat label="Latency" value={latencyMs == null ? '—' : `${latencyMs} ms`} />
          <Stat label="Events" value={eventsReceived.toString()} />
          <Stat
            label="Last"
            value={sinceLastMs == null ? '—' : `${(sinceLastMs / 1000).toFixed(1)}s ago`}
          />
        </div>
      </div>
      {/* Scroll progress bar — sits flush under the chrome and tracks
          the most recently scrolled container on the presenter side.
          Tweens smoothly even though the wire updates at ~20 Hz. */}
      <ScrollProgress scroll={activeScroll} />

      <main style={mainStyle}>
        {!state.lastAny ? (
          <WaitingPanel slug={slug} />
        ) : (
          <NowShowingPanel state={state} />
        )}
      </main>

      {/* Live cursors layer — sits above everything else, ignores
          pointer events so it never steals clicks. Renders both the
          presenter and any other viewers currently on /present/. */}
      <PresentRemoteCursors cursors={cursors} />
      {/* Click ripples sit one z-index below cursors so the ring
          blooms behind the pointer that triggered it. */}
      <PresentClickRipples ripples={ripples} />
    </div>
  );
}

// ---------- State reducer ----------

interface PresentState {
  /** Current presenter route, set by 'route' events. */
  route: RoutePayload | null;
  /**
   * Latest scroll snapshot per scrollable container the presenter
   * is using, keyed by selector ('window', '#grid-viewport', etc.).
   * Phase 4 just stores + visualizes; Phase 7+ uses this to drive
   * actual scroll on the rendered components.
   */
  scrollBySelector: Record<string, ScrollPayload>;
  /** Selector of the most recently scrolled container. */
  lastScrollSelector: string | null;
  /** Most recently hovered element id (data-present-id), or null. */
  hoverId: string | null;
  /** Most recent envelope of any type. */
  lastAny: PresentEnvelope | null;
  /** Most recent envelope per type. Useful for the debug HUD. */
  eventsByType: Partial<Record<PresentEventType, PresentEnvelope>>;
}

const initialState: PresentState = {
  route: null,
  scrollBySelector: {},
  lastScrollSelector: null,
  hoverId: null,
  lastAny: null,
  eventsByType: {},
};

type Action = { kind: 'envelope'; env: PresentEnvelope };

function presentReducer(state: PresentState, action: Action): PresentState {
  if (action.kind !== 'envelope') return state;
  const env = action.env;
  const next: PresentState = {
    ...state,
    lastAny: env,
    eventsByType: { ...state.eventsByType, [env.type]: env },
  };
  if (env.type === 'route') {
    next.route = env.payload as RoutePayload;
    // Reset scroll + hover tracking when route changes — old
    // container/element ids probably stop existing.
    next.scrollBySelector = {};
    next.lastScrollSelector = null;
    next.hoverId = null;
  } else if (env.type === 'scroll') {
    const scroll = env.payload as ScrollPayload;
    next.scrollBySelector = {
      ...state.scrollBySelector,
      [scroll.selector]: scroll,
    };
    next.lastScrollSelector = scroll.selector;
  } else if (env.type === 'hover') {
    next.hoverId = (env.payload as HoverPayload).id;
  }
  return next;
}

// ---------- Panels ----------

function WaitingPanel({ slug }: { slug: string }) {
  return (
    <div style={emptyStyle}>
      <div style={emptyTitleStyle}>Waiting for presenter…</div>
      <div style={emptySubStyle}>
        Channel <code style={codeStyle}>present:{slug}</code>
      </div>
    </div>
  );
}

function NowShowingPanel({ state }: { state: PresentState }) {
  const route = state.route;
  const fullRoute = route ? `${route.pathname}${route.search}${route.hash}` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 720 }}>
      {/* Now showing — Phase 3 lands the route, future phases fill in
          the actual rendered content. */}
      <div style={{
        ...payloadCardStyle,
        background: 'linear-gradient(180deg, rgba(167,139,250,0.06), rgba(167,139,250,0.01))',
        borderColor: 'rgba(167,139,250,0.18)',
      }}>
        <div style={payloadHeadStyle}>
          <span style={{ ...payloadTypeStyle, color: '#c4b5fd' }}>Now showing</span>
          {route && <span style={payloadSeqStyle}>route</span>}
        </div>
        {fullRoute ? (
          <div style={{
            fontFamily: FONT_MONO,
            fontSize: 18,
            color: '#fff',
            wordBreak: 'break-word',
            lineHeight: 1.5,
          }}>
            {fullRoute}
          </div>
        ) : (
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            No route received yet — presenter will appear here once they navigate.
          </div>
        )}
      </div>

      {/* Debug payload — last event of any type, raw. */}
      <DebugPayload latest={state.lastAny} />
    </div>
  );
}

function DebugPayload({ latest }: { latest: PresentEnvelope | null }) {
  if (!latest) return null;
  return (
    <details style={{ ...payloadCardStyle, padding: '14px 18px' }}>
      <summary style={{
        cursor: 'pointer',
        listStyle: 'none',
        outline: 'none',
        color: 'rgba(255,255,255,0.6)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        userSelect: 'none',
      }}>
        Last event ({latest.type} · #{latest.seq})
      </summary>
      <pre style={{ ...payloadJsonStyle, marginTop: 12 }}>
        {JSON.stringify(latest.payload, null, 2)}
      </pre>
    </details>
  );
}

// ---------- Status pill + stats ----------

function ScrollProgress({ scroll }: { scroll: ScrollPayload | null }) {
  const ratio = scroll ? scroll.ratio : 0;
  const pct = (ratio * 100).toFixed(1);
  const label = scroll?.selector ?? null;
  return (
    <div style={{
      position: 'relative',
      height: 22,
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      background: 'rgba(0,0,0,0.55)',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(90deg, rgba(167,139,250,0.5), rgba(167,139,250,0.18))`,
        width: `${ratio * 100}%`,
        transition: 'width 200ms cubic-bezier(0.22, 1, 0.36, 1)',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.62)',
        pointerEvents: 'none',
      }}>
        <span style={{ fontFamily: FONT_MONO, letterSpacing: 0, textTransform: 'none' }}>
          {label ?? 'scroll —'}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{pct}%</span>
      </div>
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

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={statStyle}>
      <span style={statLabelStyle}>{label}</span>
      <span
        style={{
          ...statValueStyle,
          maxWidth: mono ? 180 : undefined,
          overflow: mono ? 'hidden' : undefined,
          textOverflow: mono ? 'ellipsis' : undefined,
          whiteSpace: mono ? 'nowrap' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------- Styles ----------

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

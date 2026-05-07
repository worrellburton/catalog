import { useEffect, useRef, useState } from 'react';
import type {
  CursorLeavePayload,
  CursorPayload,
  PresentEnvelope,
  PresentRole,
} from '~/services/present';

/** Snapshot of one remote participant's cursor as we render it. */
export interface RemoteCursorState {
  id: string;
  name: string;
  color: string;
  role: PresentRole;
  /** Current rendered position (0..1 viewport ratio, lerped each rAF). */
  x: number;
  y: number;
  /** Latest target received from the wire. */
  targetX: number;
  targetY: number;
  /** ms timestamp of the latest event from this id. */
  lastSeen: number;
}

interface UsePresentCursorsOptions {
  /** Local participant id — its own cursor is filtered out. */
  selfId: string;
  /** Master toggle. */
  enabled?: boolean;
  /**
   * Drop a cursor after this many ms of silence. Should comfortably
   * exceed any plausible network hiccup but stay low enough that a
   * closed tab disappears quickly. Default 4500 ms.
   */
  staleMs?: number;
  /**
   * Position lerp factor per rAF (0..1). Higher = snappier; lower =
   * smoother but more "swimmy". 0.22 feels close to Figma's cursor.
   */
  lerp?: number;
}

interface UsePresentCursors {
  cursors: RemoteCursorState[];
  /** Wire this into usePresentSubscription's onEnvelope. */
  ingest: (env: PresentEnvelope) => void;
}

/**
 * Receives cursor + cursor-leave events and surfaces a list of
 * remote cursors with smoothly interpolated positions ready to
 * render. Self-id is filtered so callers can hand both their own
 * id and a single ingest function to whichever subscription hook
 * they're using.
 */
export function usePresentCursors({
  selfId,
  enabled = true,
  staleMs = 4500,
  lerp = 0.22,
}: UsePresentCursorsOptions): UsePresentCursors {
  // Source of truth lives in a ref so high-frequency ingests don't
  // trigger React re-renders. The rAF loop publishes a new snapshot
  // to setCursors when there's actually visible motion.
  const stateRef = useRef<Record<string, RemoteCursorState>>({});
  const [cursors, setCursors] = useState<RemoteCursorState[]>([]);

  // Stable ingest: writes into the ref, doesn't trigger renders.
  const ingestRef = useRef<(env: PresentEnvelope) => void>(() => {});
  ingestRef.current = (env) => {
    if (!enabled) return;
    if (env.type === 'cursor') {
      const p = env.payload as CursorPayload;
      if (!p?.id || p.id === selfId) return;
      const prev = stateRef.current[p.id];
      stateRef.current = {
        ...stateRef.current,
        [p.id]: {
          id: p.id,
          name: p.name,
          color: p.color,
          role: p.role,
          // Initialize current position to target on first sight so
          // late-joining cursors don't fly in from (0, 0).
          x: prev?.x ?? p.x,
          y: prev?.y ?? p.y,
          targetX: p.x,
          targetY: p.y,
          lastSeen: Date.now(),
        },
      };
    } else if (env.type === 'cursor-leave') {
      const p = env.payload as CursorLeavePayload;
      if (!p?.id) return;
      if (stateRef.current[p.id]) {
        const next = { ...stateRef.current };
        delete next[p.id];
        stateRef.current = next;
      }
    }
  };

  // Stable wrapper so callers can pass `ingest` into deps without
  // resubscribing.
  const ingestStableRef = useRef((env: PresentEnvelope) => {
    ingestRef.current(env);
  });

  // rAF loop: lerps each cursor towards its target, prunes stale
  // ones, and publishes to React only when something visibly moved
  // (or a cursor was added/removed).
  useEffect(() => {
    if (!enabled) {
      setCursors([]);
      return;
    }
    let raf = 0;

    const tick = () => {
      const now = Date.now();
      const src = stateRef.current;
      let nextMap: Record<string, RemoteCursorState> = src;
      let dirty = false;
      const out: RemoteCursorState[] = [];

      for (const [id, c] of Object.entries(src)) {
        if (now - c.lastSeen > staleMs) {
          if (nextMap === src) nextMap = { ...src };
          delete nextMap[id];
          dirty = true;
          continue;
        }
        const dx = c.targetX - c.x;
        const dy = c.targetY - c.y;
        if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
          const nx = c.x + dx * lerp;
          const ny = c.y + dy * lerp;
          if (nextMap === src) nextMap = { ...src };
          nextMap[id] = { ...c, x: nx, y: ny };
          dirty = true;
          out.push(nextMap[id]);
        } else {
          out.push(c);
        }
      }

      if (dirty) {
        stateRef.current = nextMap;
        setCursors(out);
      }
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [enabled, staleMs, lerp]);

  return {
    cursors,
    ingest: (env) => ingestStableRef.current(env),
  };
}

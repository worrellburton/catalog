import { useEffect, useRef } from 'react';
import type { CursorLeavePayload, CursorPayload, PresentRole } from '~/services/present';

interface BroadcastFn {
  <T>(type: 'cursor', payload: T): number | null;
  <T>(type: 'cursor-leave', payload: T): number | null;
  <T>(type: string, payload: T): number | null;
}

interface UsePresentCursorBroadcastOptions {
  /** Live broadcast function from usePresentBroadcaster. */
  broadcast: BroadcastFn;
  /** True once the channel is subscribed. Skip sends until then. */
  isConnected: boolean;
  /** Stable participant id. */
  id: string;
  /** Display name shown next to the cursor on viewers. */
  name: string;
  /** Hex color. */
  color: string;
  /** Distinguishes the presenter from any guest viewer. */
  role: PresentRole;
  /** Master toggle. */
  enabled?: boolean;
  /** Throttle floor in ms. Default 33 (~30 Hz). */
  throttleMs?: number;
}

/**
 * Captures `pointermove` on window, throttles, and broadcasts the
 * caller's cursor position as a normalized 0..1 viewport ratio so
 * different display sizes still align proportionally.
 *
 * Mirrors the Figma multiplayer pattern: also fires a one-shot
 * `cursor-leave` on tab close so peers can prune the cursor right
 * away instead of waiting for the staleness timer.
 */
export function usePresentCursorBroadcast({
  broadcast,
  isConnected,
  id,
  name,
  color,
  role,
  enabled = true,
  throttleMs = 33,
}: UsePresentCursorBroadcastOptions): void {
  const lastSentAtRef = useRef(0);
  const lastSentRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled || !isConnected) return;
    if (typeof window === 'undefined') return;

    const handleMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastSentAtRef.current < throttleMs) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const x = Math.max(0, Math.min(1, e.clientX / w));
      const y = Math.max(0, Math.min(1, e.clientY / h));
      // Skip near-duplicate frames so a stationary mouse stops sending.
      const last = lastSentRef.current;
      if (last && Math.abs(last.x - x) < 0.0008 && Math.abs(last.y - y) < 0.0008) {
        return;
      }
      lastSentAtRef.current = now;
      lastSentRef.current = { x, y };
      const payload: CursorPayload = { id, name, color, role, x, y };
      broadcast<CursorPayload>('cursor', payload);
    };

    const handleLeave = () => {
      const payload: CursorLeavePayload = { id };
      broadcast<CursorLeavePayload>('cursor-leave', payload);
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('beforeunload', handleLeave);
    // pagehide is more reliable than beforeunload on iOS Safari.
    window.addEventListener('pagehide', handleLeave);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('beforeunload', handleLeave);
      window.removeEventListener('pagehide', handleLeave);
      handleLeave();
    };
  }, [enabled, isConnected, id, name, color, role, throttleMs, broadcast]);
}

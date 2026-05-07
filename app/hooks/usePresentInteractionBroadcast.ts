import { useEffect, useRef } from 'react';
import type { ClickPayload, HoverPayload } from '~/services/present';

interface BroadcastFn {
  <T>(type: 'click', payload: T): number | null;
  <T>(type: 'hover', payload: T): number | null;
  <T>(type: string, payload: T): number | null;
}

interface UsePresentInteractionBroadcastOptions {
  broadcast: BroadcastFn;
  isConnected: boolean;
  /** Sender id, threaded into ClickPayload for de-dup. */
  id: string;
  /** Sender color, threaded into ClickPayload so ripples match cursors. */
  color: string;
  enabled?: boolean;
}

const HOVER_TARGET_SELECTOR = '[data-present-id]';
/** Hit-test cadence for hover updates. 100 ms = 10 Hz, plenty for hover. */
const HOVER_THROTTLE_MS = 100;

/**
 * Captures click + hover events on the presenter side and broadcasts
 * them. Click sends viewport-relative coords + a target id (if the
 * element under the click has data-present-id). Hover broadcasts the
 * closest [data-present-id] under the pointer; null when the pointer
 * is over un-tagged surface.
 *
 * Hover detection runs off pointermove with elementFromPoint so it
 * handles nested elements without listener bookkeeping.
 */
export function usePresentInteractionBroadcast({
  broadcast,
  isConnected,
  id,
  color,
  enabled = true,
}: UsePresentInteractionBroadcastOptions): void {
  const lastHoverIdRef = useRef<string | null>(null);
  const lastHoverHitTestAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !isConnected) return;
    if (typeof window === 'undefined') return;

    const handleClick = (e: MouseEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const x = Math.max(0, Math.min(1, e.clientX / w));
      const y = Math.max(0, Math.min(1, e.clientY / h));
      const target = (e.target as Element | null)?.closest(HOVER_TARGET_SELECTOR);
      const targetId = target?.getAttribute('data-present-id') ?? null;
      const payload: ClickPayload = { x, y, color, sourceId: id, targetId };
      broadcast<ClickPayload>('click', payload);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverHitTestAtRef.current < HOVER_THROTTLE_MS) return;
      lastHoverHitTestAtRef.current = now;
      // elementFromPoint returns the topmost element at the
      // coordinate even through pointer-events:none overlays.
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const target = hit?.closest(HOVER_TARGET_SELECTOR);
      const newId = target?.getAttribute('data-present-id') ?? null;
      if (newId === lastHoverIdRef.current) return;
      lastHoverIdRef.current = newId;
      const payload: HoverPayload = { id: newId };
      broadcast<HoverPayload>('hover', payload);
    };

    window.addEventListener('click', handleClick, { capture: true });
    window.addEventListener('pointermove', handlePointerMove, { passive: true });

    return () => {
      window.removeEventListener('click', handleClick, { capture: true });
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [enabled, isConnected, id, color, broadcast]);
}

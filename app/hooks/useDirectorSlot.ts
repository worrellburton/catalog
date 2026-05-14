// React hook that wires a card to the global PlaybackDirector.
//
// Usage:
//   const { containerRef, status } = useDirectorSlot(id, videoUrl, posterUrl);
//   return (
//     <div ref={containerRef} style={{ position: 'relative' }}>
//       <img className="card-poster" src={posterUrl} ... />
//       {/* director appends a pooled <video> into containerRef when promoted */}
//     </div>
//   );

import { useCallback, useEffect, useRef, useState } from 'react';
import { director, type CardStatus } from '~/services/video-playback-director';

export type SlotStatus = CardStatus;

/**
 * Wires a card into the global VideoPlaybackDirector.
 *
 * @param cardId    Stable unique ID for the card (creative.id).
 * @param videoUrl  The video URL this card should play.
 * @param posterUrl Poster image URL shown while no video is assigned.
 *
 * Returns:
 *   containerRef — RefCallback to attach to the card's outer div.
 *                  The director appends the pooled <video> element here
 *                  when this card is in the top-K.
 *   status       — Current playback status for this card.
 */
export function useDirectorSlot(
  cardId: string | undefined,
  videoUrl: string | null | undefined,
  posterUrl: string | null | undefined,
): {
  containerRef: (node: HTMLDivElement | null) => void;
  status: SlotStatus;
} {
  const [status, setStatus] = useState<SlotStatus>('idle');
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    // Tear down the previous registration. This fires null→node again
    // when deps change (videoUrl swap) so URL changes are handled cleanly.
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    if (nodeRef.current && cardId) director.unregister(cardId);

    nodeRef.current = node;

    if (node && cardId && videoUrl) {
      director.register(
        cardId,
        () => node.getBoundingClientRect(),
        videoUrl,
        posterUrl ?? '',
        node,
      );
      unsubRef.current = director.subscribe(cardId, setStatus);
    }
  }, [cardId, videoUrl, posterUrl]);

  // Guarantee cleanup on unmount even if the refCallback was never
  // called with null (e.g. a keyed remount that bypasses the callback).
  useEffect(() => {
    return () => {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      if (cardId) director.unregister(cardId);
    };
  }, [cardId]);

  return { containerRef, status };
}

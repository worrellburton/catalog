import { useState } from 'react';
import { useFollowState, toggleFollowShared } from '~/hooks/useFollowState';

/**
 * Follow affordance attached to a creator chip.
 *
 * NEW behavior (per user spec): the BUTTON only renders when the
 * shopper is NOT following the creator — a small "+" badge that
 * sits in the upper-right corner of the chip (positioned absolutely
 * by .follow-corner-badge CSS).
 *
 * When the shopper IS following, this component renders nothing —
 * the chip's parent applies a glow class instead (the "lit pill"
 * the user described). Use the exported `useFollowState` hook to
 * read the state at the parent if you need to add that class.
 *
 * Hides for placeholder handles ("user:<uuid>") and while the
 * shared follow cache is still resolving (avoids a "+" → glow
 * flicker on first paint).
 */

interface Props {
  handle: string | null | undefined;
  /** Outer diameter in px. Default 22 so the corner badge reads
   *  clearly at small chip sizes. */
  size?: number;
  /** Optional inline style override. Callers can shift the badge
   *  with `top`/`right` overrides for chip variants. */
  style?: React.CSSProperties;
  /** Stop event propagation when the user taps. Default true so the
   *  chip parent's onClick (open creator) doesn't also fire. */
  stopPropagation?: boolean;
  /** Fires after the toggle completes. */
  onAfter?: (following: boolean) => void;
}

export default function FollowIconButton({
  handle,
  size = 22,
  style,
  stopPropagation = true,
  onAfter,
}: Props) {
  const following = useFollowState(handle);
  const [busy, setBusy] = useState(false);
  if (!handle || handle.startsWith('user:')) return null;
  // Cache still resolving — don't render either state to avoid flicker.
  if (following === null) return null;
  // Following = the chip itself glows (parent applies .is-following).
  // The button has no role in that state.
  if (following) return null;

  return (
    <button
      type="button"
      onClick={async (e) => {
        if (stopPropagation) e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
          const next = await toggleFollowShared(handle);
          onAfter?.(next);
        } catch { /* shared cache reverts itself */ }
        finally { setBusy(false); }
      }}
      disabled={busy}
      title="Follow this creator"
      aria-label={`Follow ${handle}`}
      className="follow-corner-badge"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1.5px solid rgba(255, 255, 255, 0.9)',
        background: 'rgba(20, 20, 20, 0.85)',
        boxShadow:
          '0 1px 3px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(0, 0, 0, 0.4)',
        color: '#fff',
        cursor: busy ? 'wait' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        flexShrink: 0,
        transition: 'background 180ms ease, transform 160ms ease',
        ...style,
      }}
    >
      <svg
        width={Math.round(size * 0.55)}
        height={Math.round(size * 0.55)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );
}

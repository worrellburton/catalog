import { useState } from 'react';
import { useFollowState, toggleFollowShared } from '~/hooks/useFollowState';

/**
 * Icon-only follow toggle. Renders next to a creator chip — "+" when
 * not following, "✓" when following. No text. Hides itself for
 * placeholder handles ("user:<uuid>") and while the shared follow
 * cache is still resolving for this handle (avoids a flicker of
 * "+" → "✓" on first paint).
 */

interface Props {
  handle: string | null | undefined;
  /** Outer button diameter in px. Default 18 — matches the avatar
   *  ring on the consumer feed creator chip. */
  size?: number;
  /** Optional override for inline styles applied to the button —
   *  callers can add `marginLeft: 0` for chip layouts where the
   *  button is the only follow-up affordance. */
  style?: React.CSSProperties;
  /** Stop event propagation when the user taps the button. Default
   *  true — most chip parents are themselves clickable (open creator
   *  page) and a follow click must not bubble. */
  stopPropagation?: boolean;
  /** Onclick handler that fires AFTER the toggle completes. Useful
   *  for callers that want to refresh a follower count. */
  onAfter?: (following: boolean) => void;
}

export default function FollowIconButton({
  handle,
  size = 18,
  style,
  stopPropagation = true,
  onAfter,
}: Props) {
  const following = useFollowState(handle);
  const [busy, setBusy] = useState(false);
  if (!handle || handle.startsWith('user:')) return null;
  if (following === null) return null;
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
      aria-pressed={following}
      title={following ? 'Following — click to unfollow' : 'Follow this creator'}
      aria-label={following ? `Unfollow ${handle}` : `Follow ${handle}`}
      className="follow-icon-btn"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `1.5px solid ${following ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)'}`,
        background: following ? 'rgba(255,255,255,0.18)' : 'transparent',
        color: '#fff',
        cursor: busy ? 'wait' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        flexShrink: 0,
        transition: 'background 160ms ease, border-color 160ms ease, transform 160ms ease',
        ...style,
      }}
    >
      {following ? (
        <svg width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      )}
    </button>
  );
}

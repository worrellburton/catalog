import { useEffect, useState } from 'react';
import { listUserGenerations } from '~/services/user-generations';
import { useAuth } from '~/hooks/useAuth';

/**
 * Header indicator that surfaces when the signed-in user has a look
 * still rendering after they've left the /generate screen via "Keep
 * discovering". Tapping the pill returns to /generate so they can
 * watch progress or run another action against the in-flight job.
 *
 * Polls listUserGenerations every 6s while at least one row is
 * unfinished. When everything is 'done' (or 'failed') the pill
 * disappears on the next tick so it doesn't haunt the header. Hidden
 * for signed-out shoppers.
 */
export default function PendingLookPill({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth();
  const [pending, setPending] = useState<{ id: string; status: string; style: string | null } | null>(null);

  useEffect(() => {
    if (!user) { setPending(null); return; }
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      const rows = await listUserGenerations(user.id);
      if (cancelled) return;
      const inFlight = rows.find(r => r.status !== 'done' && r.status !== 'failed');
      setPending(inFlight ? { id: inFlight.id, status: inFlight.status, style: inFlight.style ?? null } : null);
      if (inFlight) {
        timer = window.setTimeout(tick, 6000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [user]);

  if (!pending) return null;
  const label = pending.style ? `Your ${pending.style.toLowerCase()} look is rendering` : 'Your look is rendering';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pending-look-pill"
      aria-label={label}
      title={label}
    >
      <span className="pending-look-pill-spinner" aria-hidden="true" />
      <span className="pending-look-pill-label">{label}</span>
    </button>
  );
}

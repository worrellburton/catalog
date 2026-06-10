import { useEffect, useState } from 'react';
import { useAuth } from '~/hooks/useAuth';
import { getWalletBalance } from '~/services/earnings';

interface HeaderWalletPillProps {
  onOpenWallet: () => void;
}

/**
 * Compact earnings indicator that lives in the home header next to
 * the bookmark + avatar buttons. Always renders when the user is
 * signed in — defaults to $0.00 while the balance loads (or if the
 * wallet endpoint errors), so the indicator is never "missing"
 * just because the network blipped.
 */
export default function HeaderWalletPill({ onOpenWallet }: HeaderWalletPillProps) {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getWalletBalance()
      .then(b => { if (!cancelled) setBalance(typeof b === 'number' ? b : 0); })
      .catch(() => { /* keep showing $0.00 */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!user?.id) return null;

  return (
    <button
      type="button"
      className="header-wallet-pill"
      onClick={onOpenWallet}
      aria-label="Open wallet"
      title="Your earnings"
    >
      <span>${balance.toFixed(2)}</span>
    </button>
  );
}

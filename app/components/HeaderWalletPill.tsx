import { useEffect, useState } from 'react';
import { useAuth } from '~/hooks/useAuth';
import { getWallet } from '~/services/earnings';

interface HeaderWalletPillProps {
  onOpenWallet: () => void;
}

/**
 * Compact earnings indicator that lives in the home header next to
 * the bookmark + avatar buttons. Mirrors the green "$0.00" pill that
 * sits on ProductPage to the left of the Save button. Single fetch on
 * mount when the user is authenticated; stays hidden otherwise.
 */
export default function HeaderWalletPill({ onOpenWallet }: HeaderWalletPillProps) {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id) { setBalance(null); return; }
    let cancelled = false;
    getWallet(1, 1)
      .then(w => { if (!cancelled) setBalance(w.current_balance); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!user?.id || balance === null) return null;

  return (
    <button
      type="button"
      className="header-wallet-pill"
      onClick={onOpenWallet}
      aria-label="Open wallet"
      title="Your earnings"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
        <path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>
      </svg>
      <span>${balance.toFixed(2)}</span>
    </button>
  );
}

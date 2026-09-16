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

  // When running inside the Flutter native shell, the web <header> is hidden
  // and the shell draws its own copy of this pill. This component still mounts
  // and fetches here, so mirror the balance up to the native header over the
  // `catalogWalletBalance` JS bridge (no native re-fetch of the authed edge fn).
  useEffect(() => {
    const fw = (window as unknown as {
      flutter_inappwebview?: { callHandler?: (name: string, ...args: unknown[]) => void };
    }).flutter_inappwebview;
    if (!fw?.callHandler) return;
    if (document.documentElement.dataset.shell !== 'catalog-app') return;
    fw.callHandler('catalogWalletBalance', balance);
  }, [balance]);

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

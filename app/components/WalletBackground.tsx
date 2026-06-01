import { useEffect, useState, memo } from 'react';
import ParticleBackground from './ParticleBackground';

/**
 * Wallet background — concentric thin green rings expanding outward from
 * the screen center (money rippling through the economy, value growing
 * together) layered with the AI-diamond particle field. Passive at rest;
 * a 'wallet:payout' event injects a bright burst-ring that races outward,
 * and 'wallet:burst' adds a ring at an arbitrary point.
 *
 * The rings are CSS-only DOM elements (one div per ring, infinite animation
 * with staggered delays), so the visual cost is a handful of compositor-
 * accelerated transforms. The particle layer keeps brand continuity with
 * the home hero / sign-in gate.
 *
 * Events (window-scoped):
 *   wallet:burst  — { x, y } in viewport coords; injects a localized ring.
 *   wallet:payout — bright green burst from center; fades after ~3s.
 */

interface WalletBackgroundProps {
  /** Kept for API compatibility with the prior scroll-driven design.
   *  The new design is passive so this prop is unused. */
  scrollEl?: HTMLElement | null;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  variant: 'normal' | 'payout';
}

const WalletBackground = memo(function WalletBackground(_: WalletBackgroundProps) {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    let next = 0;
    const onBurst = (e: Event) => {
      const ev = e as CustomEvent<{ x?: number; y?: number }>;
      const x = ev.detail?.x ?? window.innerWidth / 2;
      const y = ev.detail?.y ?? window.innerHeight / 2;
      const id = next++;
      setBursts(b => [...b, { id, x, y, variant: 'normal' }]);
      window.setTimeout(() => setBursts(b => b.filter(r => r.id !== id)), 2400);
    };
    const onPayout = () => {
      const id = next++;
      setBursts(b => [...b, { id, x: window.innerWidth / 2, y: window.innerHeight * 0.35, variant: 'payout' }]);
      window.setTimeout(() => setBursts(b => b.filter(r => r.id !== id)), 3200);
    };
    window.addEventListener('wallet:burst', onBurst as EventListener);
    window.addEventListener('wallet:payout', onPayout as EventListener);
    return () => {
      window.removeEventListener('wallet:burst', onBurst as EventListener);
      window.removeEventListener('wallet:payout', onPayout as EventListener);
    };
  }, []);

  return (
    <div className="wb-root" aria-hidden="true">
      {/* Six concentric rings emanating from the center, staggered so
          there's always one mid-expansion. */}
      <div className="wb-ring-field">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="wb-ring" style={{ animationDelay: `${i * 1.2}s` }} />
        ))}
      </div>

      {/* Localized & payout burst rings — mounted on demand by the event
          handlers above. */}
      {bursts.map(b => (
        <span
          key={b.id}
          className={`wb-burst wb-burst--${b.variant}`}
          style={{ left: b.x, top: b.y }}
        />
      ))}

      {/* AI-diamond particle drift on top, lightly tinted by CSS. */}
      <div className="wb-particles">
        <ParticleBackground />
      </div>
    </div>
  );
});

export default WalletBackground;

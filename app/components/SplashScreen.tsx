
import { useState, useEffect } from 'react';
import CatalogLogo from './CatalogLogo';

export default function SplashScreen() {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Fixed 2000ms hold so the splash is consistent every cold open
    // (and on every entry into the app from the landing) — the user
    // wanted a deterministic beat, not "however long the network takes".
    // Matches SPLASH_MIN_MS / SPLASH_MAX_MS in useAppView and the
    // setTimeout in handleLandingToApp; all three should stay in sync.
    const timer = setTimeout(() => setFadeOut(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`splash-screen active ${fadeOut ? 'fade-out' : ''}`}>
      {/* Counterclockwise conic-gradient sweep, ~10s, slow ease on both
          ends. The conic sweep + the singleton particle field (visible
          through the splash's translucent background) together hand the
          stage off to the landing — when the splash fades, the same
          particles + the same matte black continue on the hero. */}
      <div className="splash-sweep" aria-hidden="true" />
      <div className="splash-content">
        <CatalogLogo className="splash-logo" />
      </div>
    </div>
  );
}

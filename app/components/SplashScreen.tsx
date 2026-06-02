
import { useState, useEffect } from 'react';
import CatalogLogo from './CatalogLogo';

export default function SplashScreen() {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Quick handoff — was 1800ms which made the splash feel like a wait
    // screen instead of a brand cue. 900ms is enough for the wordmark
    // to spin in and start a single arc of the gradient sweep before
    // the fade begins; combined with the shorter CSS transition (0.4s)
    // the splash → landing handoff feels like a single quick beat.
    const timer = setTimeout(() => setFadeOut(true), 900);
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

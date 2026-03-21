
import { useState, useEffect } from 'react';
import CatalogLogo from './CatalogLogo';

export default function SplashScreen() {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFadeOut(true), 1800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`splash-screen active ${fadeOut ? 'fade-out' : ''}`}>
      <div className="splash-content">
        <CatalogLogo className="splash-logo" />
      </div>
    </div>
  );
}

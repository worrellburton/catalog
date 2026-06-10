import { useState } from 'react';
import CatalogLogo from './CatalogLogo';
import ParticleBackground from './ParticleBackground';
import { signInWithGoogle } from '~/services/auth';

// The signup scrim that gates the "features" for guests. It dissolves in
// over whatever's underneath (a look teaser, the creator catalog, or the
// feed) so the moment reads as "you've hit something worth signing up for"
// rather than a hard wall.
//
//   • 'look'    — fired after a guest's free look is spent, dissolved over
//                 a ~1s teaser of the look they tapped.
//   • 'creator' — fired when a guest taps into a creator catalog.
//   • 'feed'    — the softer scroll nudge; carries a "Continue as guest"
//                 escape so they can keep browsing products.
export type GuestGateVariant = 'look' | 'creator' | 'feed';

const COPY: Record<GuestGateVariant, { title: string; sub: string }> = {
  look: {
    title: 'Sign up to see creator looks',
    sub: 'Watch every look, save your favorites, and get a daily feed picked for you.',
  },
  creator: {
    title: 'Sign up to see creator catalogs',
    sub: 'Follow creators, browse their full catalogs, and shop everything they wear.',
  },
  feed: {
    title: 'Get your own daily feed',
    sub: 'Register for Catalog to unlock creator looks, follows, saves, and a feed that learns your taste.',
  },
};

export default function GuestSignupGate({
  variant,
  onClose,
  onContinueGuest,
}: {
  variant: GuestGateVariant;
  /** Dismiss the gate (X, top-right). Look/creator gates use it to go back
   *  to the feed; the feed nudge uses it as the quiet dismiss. */
  onClose?: () => void;
  /** The explicit "Continue as guest" text button — only the soft 'feed'
   *  nudge offers it (keep browsing products). */
  onContinueGuest?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const copy = COPY[variant];

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    const result = await signInWithGoogle();
    if (result.error) {
      setError(result.error);
      setLoading(false);
    }
    // On success the page redirects to Google; the stored guest intent is
    // replayed when auth resolves back in the app.
  };

  return (
    <div className={`guest-gate guest-gate--${variant}`} role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="guest-gate-particles" aria-hidden="true">
        <ParticleBackground speed={1} />
      </div>
      {onClose && (
        <button className="guest-gate-close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
      <div className="guest-gate-content">
        <CatalogLogo className="guest-gate-logo" />
        <h2 className="guest-gate-title">{copy.title}</h2>
        <p className="guest-gate-sub">{copy.sub}</p>

        <button className="guest-gate-google" onClick={handleGoogle} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <span>{loading ? 'Signing in…' : 'Continue with Google'}</span>
        </button>

        {error && <p className="guest-gate-error">{error}</p>}

        {onContinueGuest && (
          <button className="guest-gate-continue" onClick={onContinueGuest} disabled={loading}>
            Continue as guest
          </button>
        )}
      </div>
    </div>
  );
}

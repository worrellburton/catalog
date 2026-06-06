import { useState } from 'react';
import { signInWithGoogle } from '~/services/auth';

interface LookSignInGateProps {
  /** Close the look and return to the feed (the "not now" exit). */
  onClose: () => void;
}

/**
 * Sign-in gate shown over a look for signed-out visitors. The look renders
 * underneath (visible through the translucent scrim) so a shared /l/<slug>
 * link still gives a taste of the content — then this prompts the visitor to
 * sign in before they can actually shop / save / follow. Registered users
 * never see it (the caller only mounts it when there's no auth user).
 */
export default function LookSignInGate({ onClose }: LookSignInGateProps) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    const result = await signInWithGoogle();
    if (result.error) {
      setError(result.error);
      setLoading(false);
    }
  };

  return (
    <div className="look-signin-gate" role="dialog" aria-modal="true" aria-label="Sign in to continue">
      <div className="lsg-card">
        <button className="lsg-close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <h2 className="lsg-title">Sign in to see this look</h2>
        <p className="lsg-sub">Catalog is members-only. Sign in to shop the look, save your favorites, and follow creators.</p>
        <button className="lsg-google" onClick={handleGoogleSignIn} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <span>{loading ? 'Signing in…' : 'Continue with Google'}</span>
        </button>
        {error && <p className="lsg-error">{error}</p>}
      </div>
    </div>
  );
}

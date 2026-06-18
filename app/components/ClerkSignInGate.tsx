import { useUser, SignIn } from '@clerk/clerk-react';

// Phase 1 gate cutover (mounted flag-gated from _index). When Clerk is enabled
// (VITE_CLERK_PUBLISHABLE_KEY set) this REPLACES the access-code PasswordGate:
// it overlays Clerk's sign-in (Google SSO + phone, per dashboard) whenever the
// visitor is signed out, and renders nothing once signed in so the app shows
// through. Reuses the .password-gate backdrop (fixed, full-screen, z-index 500).
// Lazy-loaded by _index so the Clerk SDK never enters the feed bundle.
//
// NOTE: this gates ENTRY on a Clerk session. The Supabase data layer isn't
// bridged to Clerk until Phase 2, so a Clerk-signed-in user sees the app but
// RLS-protected reads behave as anonymous until then — expected during the
// rollout, which is why the gate only activates where the key is set.

export default function ClerkSignInGate() {
  const { isLoaded, isSignedIn } = useUser();
  // While Clerk resolves the session, or once signed in, show no gate.
  if (!isLoaded || isSignedIn) return null;
  return (
    <div className="password-gate">
      <SignIn routing="hash" signUpUrl="/sign-up" />
    </div>
  );
}

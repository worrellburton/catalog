import { SignIn, SignUp } from '@clerk/clerk-react';

// Phase 1 — standalone Clerk sign-in / sign-up surfaces (/sign-in, /sign-up).
//
// The auth METHODS shown here (Google SSO, phone/SMS one-time code, email, …)
// are whatever is enabled in the Clerk dashboard for this instance — the
// component renders them automatically. Nothing about the method set is
// hardcoded here; to add/remove Google or phone you flip them in the dashboard.
//
// Self-contained by design: it does NOT touch the existing access-code gate in
// _index, and because it's imported only by the /sign-in + /sign-up route files,
// the Clerk SDK stays code-split out of the main feed bundle (it loads only when
// these routes are visited). Provider context comes from ClerkGate in root.tsx,
// which mounts only when VITE_CLERK_PUBLISHABLE_KEY is set — so guard the no-key
// case to avoid a "must be inside ClerkProvider" error during rollout.

const HAS_KEY = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function ClerkAuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#0a0a0a',
      }}
    >
      {!HAS_KEY ? (
        <p style={{ color: '#a1a1aa', fontSize: 14, textAlign: 'center', maxWidth: 380, lineHeight: 1.5 }}>
          Clerk isn’t configured yet. Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> (dev/staging
          first) and enable Google + phone in the Clerk dashboard to see the sign-in here.
        </p>
      ) : mode === 'sign-in' ? (
        <SignIn routing="hash" signUpUrl="/sign-up" />
      ) : (
        <SignUp routing="hash" signInUrl="/sign-in" />
      )}
    </div>
  );
}

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

// Phase 0 — Clerk foundation, adapted for this Remix *SPA* (ssr:false). The
// generic `clerk init` scaffolds @clerk/remix, which needs a server-side
// rootAuthLoader and so can't work here; the right SDK for a client-only app is
// @clerk/clerk-react with a top-level <ClerkProvider>.
//
// This gate keeps Clerk completely INERT until VITE_CLERK_PUBLISHABLE_KEY is
// set: with no key (prod today) it renders children untouched AND never even
// imports the Clerk SDK (dynamic import below), so the bundle and the current
// Supabase-auth path are unchanged. Set the key on dev/staging to switch it on.
//
// Phase 1 wires the actual sign-in / sign-up / UserButton UI and the gate swap;
// at that point the "key present but provider still loading" branch should show
// a splash instead of children (nothing consumes Clerk hooks yet, so returning
// children is safe for now).

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

type ClerkProviderType = ComponentType<{ publishableKey: string; children: ReactNode }>;

export default function ClerkGate({ children }: { children: ReactNode }) {
  const [Provider, setProvider] = useState<ClerkProviderType | null>(null);

  useEffect(() => {
    if (!PUBLISHABLE_KEY) return;
    let active = true;
    void import('@clerk/clerk-react').then((m) => {
      if (active) setProvider(() => m.ClerkProvider as ClerkProviderType);
    });
    return () => { active = false; };
  }, []);

  if (!PUBLISHABLE_KEY || !Provider) return <>{children}</>;
  return <Provider publishableKey={PUBLISHABLE_KEY}>{children}</Provider>;
}

// Cold-boot view decision, extracted from useAppView so it can be unit-tested
// without a DOM. useAppView holds the live adapter that reads window/document
// and calls this.

export type AppView = 'locked' | 'app' | 'waitlisted';

export interface InitialViewEnv {
  /** URL has a ?look= deep-link param. */
  hasLookParam: boolean;
  /** This tab already booted the app this session (sessionStorage flag). */
  warm: boolean;
  /** location.hash without the leading '#'. */
  hash: string;
  /** Running inside the native shell (data-shell="catalog-app"). */
  inShell: boolean;
  /** A Supabase auth token is already in storage (persisted or shell-injected). */
  hasSession: boolean;
}

/** Decide the initial view before auth resolves. 'locked' renders the web
 *  guest gate; 'app' renders the feed. */
export function decideInitialView(env: InitialViewEnv): AppView {
  // Deep-linked look → straight to content, never behind a gate/splash.
  if (env.hasLookParam) return 'app';
  // Warm remount heading to #app → skip the cold-boot gate/splash replay.
  if (env.warm && env.hash === 'app') return 'app';
  // Native shell with a seeded/persisted session: the user is authed (the
  // native LoginScreen owns the logged-out state), so never render the web
  // guest gate on cold boot — it flashes before the injected session resolves.
  if (env.inShell && env.hasSession) return 'app';
  return 'locked';
}

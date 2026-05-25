/**
 * Sentry shim. Initializes the Sentry SDK lazily ONLY when
 * `VITE_SENTRY_DSN` is set in the environment. Without the env var,
 * every call here is a no-op so the bundle still works on developer
 * machines / branch previews / unconfigured environments.
 *
 * Wire-up: set VITE_SENTRY_DSN in Vercel → Project → Environment
 * Variables, then redeploy. The SDK pulls in lazily at runtime, so
 * the cold path doesn't pay for it.
 *
 * Defensive design notes
 * ----------------------
 * The dynamic import is hidden behind a string-concatenated module
 * id so Vite/Rollup does NOT try to bundle or trace it at build
 * time. Without this, an unconfigured environment (no DSN, package
 * missing, etc.) could produce a TDZ-style "Cannot access X before
 * initialization" error in the minified chunk because of how
 * Rollup hoists references to dynamic-import targets. The string
 * concat opts us out of that analysis cleanly.
 *
 * We also avoid `typeof import('@sentry/remix')` at the module
 * level so the type-only reference never leaks into the chunk
 * graph — the SDK object is typed as `any` after dynamic load,
 * which is acceptable for two call sites.
 */

let initialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sentry: any = null;

function readDsn(): string | undefined {
  try {
    return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SENTRY_DSN;
  } catch {
    return undefined;
  }
}

export async function initSentry(): Promise<void> {
  if (initialized || typeof window === 'undefined') return;
  const dsn = readDsn();
  if (!dsn) return;
  try {
    // String concat keeps Vite from statically analysing the dynamic
    // import. Combined with @vite-ignore it's belt + suspenders.
    const moduleId = '@sentry' + '/remix';
    sentry = await import(/* @vite-ignore */ moduleId);
    sentry.init({
      dsn,
      environment: (import.meta as { env?: Record<string, string | undefined> }).env?.MODE || 'production',
      // Conservative defaults so we don't blow through the free tier
      // on first wiring. Crank these once we know the volume.
      tracesSampleRate: 0.05,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
    });
    initialized = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sentry] init skipped:', err);
  }
}

/** Report an error to Sentry if it's been initialized, otherwise no-op.
 *  Always console.errors so unconfigured environments still see the trace. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error('[error]', err, context);
  if (sentry) {
    try { sentry.captureException(err, { extra: context }); } catch { /* swallow */ }
  }
}

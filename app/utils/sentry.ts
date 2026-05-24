/**
 * Sentry shim. Initializes the Sentry SDK lazily ONLY when
 * `VITE_SENTRY_DSN` is set in the environment. Without the env var,
 * every call here is a no-op so the bundle still works on developer
 * machines / branch previews / unconfigured environments.
 *
 * Wire-up: set VITE_SENTRY_DSN in Vercel → Project → Environment
 * Variables, then redeploy. The SDK pulls in lazily at runtime, so
 * the cold path doesn't pay for it.
 */

let initialized = false;
let sentry: typeof import('@sentry/remix') | null = null;

export async function initSentry(): Promise<void> {
  if (initialized || typeof window === 'undefined') return;
  const dsn = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    sentry = await import('@sentry/remix');
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
    console.warn('[sentry] init failed:', err);
  }
}

/** Report an error to Sentry if it's been initialized, otherwise no-op.
 *  Always console.errors so unconfigured environments still see the trace. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error('[error]', err, context);
  if (sentry) {
    sentry.captureException(err, { extra: context });
  }
}

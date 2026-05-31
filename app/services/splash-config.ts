// Splash configuration — the cinematic cold-open animation.
//
// Stored in app_settings so the /admin/splash page can pick a variant
// (or turn it off entirely) and tune duration without a deploy. The
// consumer reads these once at boot (splash only plays on a cold open,
// long before a realtime channel would matter).

import { getAppSetting, setAppSetting } from '~/services/app-settings';

export const SPLASH_VARIANT_KEY = 'splash_variant';
export const SPLASH_DURATION_KEY = 'splash_duration_ms';
/** Legacy on/off flag — still read for back-compat when no variant set. */
export const SPLASH_ENABLED_KEY = 'splash_enabled';

// The catalogue of motion concepts. Order here is the order shown in
// the admin picker. Adding a concept = add an id here + a registry entry
// in app/components/splash/registry.ts.
export const SPLASH_VARIANT_IDS = [
  'cascade',
  'sphere',
  'vortex',
  'constellation',
  'liquid',
  'mosaic',
] as const;

export type SplashVariantId = (typeof SPLASH_VARIANT_IDS)[number];
/** 'none' disables the splash (a first-class pick in the admin list). */
export type SplashSelection = SplashVariantId | 'none';

export const DEFAULT_SPLASH_VARIANT: SplashVariantId = 'cascade';

export interface SplashConfig {
  /** Which concept is live, or 'none'. */
  variant: SplashSelection;
  /** Convenience: variant !== 'none'. */
  enabled: boolean;
  /** Total play time before the feed is interactive. Clamped 1500–6000. */
  durationMs: number;
}

export const DEFAULT_SPLASH_CONFIG: SplashConfig = {
  variant: DEFAULT_SPLASH_VARIANT,
  enabled: true,
  durationMs: 2500,
};

function clampDuration(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SPLASH_CONFIG.durationMs;
  return Math.min(6000, Math.max(1500, Math.round(n)));
}

function isSelection(v: string | null): v is SplashSelection {
  return v === 'none' || (SPLASH_VARIANT_IDS as readonly string[]).includes(v ?? '');
}

export async function getSplashConfig(): Promise<SplashConfig> {
  const [variantRaw, durationRaw, enabledRaw] = await Promise.all([
    getAppSetting(SPLASH_VARIANT_KEY),
    getAppSetting(SPLASH_DURATION_KEY),
    getAppSetting(SPLASH_ENABLED_KEY),
  ]);

  // Resolve the active variant. New `splash_variant` key wins; otherwise
  // fall back to the legacy on/off flag (off → none, on/unset → default).
  let variant: SplashSelection;
  if (isSelection(variantRaw)) {
    variant = variantRaw;
  } else if (enabledRaw === 'false') {
    variant = 'none';
  } else {
    variant = DEFAULT_SPLASH_VARIANT;
  }

  return {
    variant,
    enabled: variant !== 'none',
    durationMs: durationRaw == null ? DEFAULT_SPLASH_CONFIG.durationMs : clampDuration(Number(durationRaw)),
  };
}

export async function setSplashVariant(variant: SplashSelection): Promise<{ error: string | null }> {
  // Keep the legacy flag in sync so any old reader still behaves.
  await setAppSetting(SPLASH_ENABLED_KEY, variant === 'none' ? 'false' : 'true');
  return setAppSetting(SPLASH_VARIANT_KEY, variant);
}

export async function setSplashDuration(ms: number): Promise<{ error: string | null }> {
  return setAppSetting(SPLASH_DURATION_KEY, String(clampDuration(ms)));
}

// Splash configuration — the cinematic cold-open animation.
//
// Stored in app_settings under a small set of keys so the /admin/splash
// page can toggle it on/off and tune the duration without a deploy.
// The consumer reads these once at boot (no realtime needed — splash
// only plays on a cold open, long before the channel would matter).

import { getAppSetting, setAppSetting } from '~/services/app-settings';

export const SPLASH_ENABLED_KEY = 'splash_enabled';
export const SPLASH_DURATION_KEY = 'splash_duration_ms';

export interface SplashConfig {
  enabled: boolean;
  /** Total play time before the feed is interactive. Clamped 1500–6000. */
  durationMs: number;
}

export const DEFAULT_SPLASH_CONFIG: SplashConfig = {
  enabled: true,
  durationMs: 2500,
};

function clampDuration(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SPLASH_CONFIG.durationMs;
  return Math.min(6000, Math.max(1500, Math.round(n)));
}

export async function getSplashConfig(): Promise<SplashConfig> {
  const [enabledRaw, durationRaw] = await Promise.all([
    getAppSetting(SPLASH_ENABLED_KEY),
    getAppSetting(SPLASH_DURATION_KEY),
  ]);
  return {
    enabled: enabledRaw == null ? DEFAULT_SPLASH_CONFIG.enabled : enabledRaw === 'true',
    durationMs: durationRaw == null ? DEFAULT_SPLASH_CONFIG.durationMs : clampDuration(Number(durationRaw)),
  };
}

export async function setSplashEnabled(enabled: boolean): Promise<{ error: string | null }> {
  return setAppSetting(SPLASH_ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function setSplashDuration(ms: number): Promise<{ error: string | null }> {
  return setAppSetting(SPLASH_DURATION_KEY, String(clampDuration(ms)));
}

import { describe, it, expect } from 'vitest';
import { decideInitialView } from './appView';

const base = { hasLookParam: false, warm: false, hash: '', inShell: false, hasSession: false };

describe('decideInitialView', () => {
  it('defaults to locked on a cold web boot with no session', () => {
    expect(decideInitialView(base)).toBe('locked');
  });

  it('goes straight to app for a deep-linked look', () => {
    expect(decideInitialView({ ...base, hasLookParam: true })).toBe('app');
  });

  it('goes to app on a warm remount to #app', () => {
    expect(decideInitialView({ ...base, warm: true, hash: 'app' })).toBe('app');
  });

  it('starts on the feed (not the guest gate) in the native shell with a seeded session', () => {
    // Regression: cold shell boot returned 'locked', flashing the web
    // Google-only guest gate before the injected session resolved.
    expect(decideInitialView({ ...base, inShell: true, hasSession: true })).toBe('app');
  });

  it('still locks a shell boot with no session', () => {
    expect(decideInitialView({ ...base, inShell: true, hasSession: false })).toBe('locked');
  });
});

// _shared/ssrf-guard.test.ts — dependency-free unit test for the SSRF guard.
// Run: deno test --no-check supabase/functions/_shared/ssrf-guard.test.ts
//
// Matrix source: whole-branch review finding F6. Every URL previously listed
// as "currently ALLOWED" (the bypass) must now be blocked; every URL listed
// as "correctly blocks" / "correctly allows" today must not regress.

import { urlAllowed, isBlockedHost } from './ssrf-guard.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
}

// F6 bypasses — WHATWG URL normalizes each of these to the hostname shown in
// the comment; all five were reachable before this fix.
const PREVIOUSLY_BYPASSED = [
  ['https://[::ffff:127.0.0.1]/', '[::ffff:7f00:1]'],
  ['https://[::ffff:169.254.169.254]/', '[::ffff:a9fe:a9fe]'],
  ['https://[64:ff9b::127.0.0.1]/', '[64:ff9b::7f00:1]'],
  ['https://[::]/', '[::]'],
  ['https://foo.localhost/', 'foo.localhost'],
] as const;

// Already-correct blocks — must not regress.
const KEEP_BLOCKED = [
  ['https://2130706433/', '127.0.0.1'],        // decimal IPv4
  ['https://0x7f000001/', '127.0.0.1'],        // hex IPv4
  ['https://127.1/', '127.0.0.1'],             // short-form IPv4
  ['https://[0:0:0:0:0:0:0:1]/', '[::1]'],     // expanded ::1
] as const;

// Already-correct allow — must not regress (fc-prefix scoped to IPv6 literals only).
const KEEP_ALLOWED = [
  ['https://fcuk.com/', 'fcuk.com'],
] as const;

Deno.test('F6: previously-bypassed SSRF targets are now blocked', () => {
  for (const [url, expectedHost] of PREVIOUSLY_BYPASSED) {
    const parsedHost = new URL(url).hostname;
    assert(parsedHost === expectedHost, `${url} normalized to ${parsedHost}, expected ${expectedHost}`);
    assert(urlAllowed(url) === null, `expected BLOCKED, was ALLOWED: ${url}`);
  }
});

Deno.test('F6: pre-existing blocks do not regress', () => {
  for (const [url, expectedHost] of KEEP_BLOCKED) {
    const parsedHost = new URL(url).hostname;
    assert(parsedHost === expectedHost, `${url} normalized to ${parsedHost}, expected ${expectedHost}`);
    assert(urlAllowed(url) === null, `expected BLOCKED, was ALLOWED: ${url}`);
  }
});

Deno.test('F6: pre-existing allows do not regress (fcuk.com, real apparel brand)', () => {
  for (const [url, expectedHost] of KEEP_ALLOWED) {
    const parsedHost = new URL(url).hostname;
    assert(parsedHost === expectedHost, `${url} normalized to ${parsedHost}, expected ${expectedHost}`);
    assert(urlAllowed(url) !== null, `expected ALLOWED, was BLOCKED: ${url}`);
  }
});

Deno.test('isBlockedHost: direct hex-form checks (belt-and-suspenders on the decoder itself)', () => {
  assert(isBlockedHost('[::ffff:7f00:1]'), '::ffff:7f00:1 (127.0.0.1 mapped) should block');
  assert(isBlockedHost('[::ffff:a9fe:a9fe]'), '::ffff:a9fe:a9fe (169.254.169.254 mapped) should block');
  assert(isBlockedHost('[64:ff9b::7f00:1]'), '64:ff9b::7f00:1 (NAT64 127.0.0.1) should block');
  assert(isBlockedHost('[::]'), ':: (unspecified) should block');
  assert(isBlockedHost('foo.localhost'), '*.localhost should block');
  assert(!isBlockedHost('fcuk.com'), 'fcuk.com must stay allowed');
  assert(!isBlockedHost('fdny.org'), 'fdny.org (fd-prefixed hostname, not IPv6) must stay allowed');
  // A public IPv6 address must not be blocked by the mapped/NAT64 decoders.
  assert(!isBlockedHost('[2001:4860:4860::8888]'), 'public IPv6 (Google DNS) must stay allowed');
});

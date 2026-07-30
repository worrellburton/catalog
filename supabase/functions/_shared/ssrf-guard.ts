// _shared/ssrf-guard.ts — SSRF host-blocking guard shared by check-product-links
// and verify-product-image (previously two copies that had drifted; collapsed
// to one so a fix here covers every fetcher of untrusted merchant/candidate URLs).
//
// ponytail: does NOT defend DNS-rebinding (a public host resolving to a private
// IP) — Deno has no resolve-then-pin hook; acceptable since these URLs come
// from our own crawled/scraped catalog, not arbitrary user input.

// IPv4-mapped (::ffff:a.b.c.d, normalized by WHATWG URL to ::ffff:<hex>:<hex>)
// and NAT64 (64:ff9b::a.b.c.d / 64:ff9b::<hex>:<hex>) embed a real IPv4 address
// in the last 32 bits. Decode both the hex-group form (what `new URL()` actually
// produces) and the dotted-quad form (in case an already-dotted literal reaches
// us some other way) so the IPv4 rules below can be applied to what's inside.
const IPV4_MAPPED_RE = /^::ffff:(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}))$/i;
const NAT64_RE = /^64:ff9b::(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}))$/i;
const DOTTED_QUAD_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function hexGroupsToDotted(hi: string, lo: string): string | null {
  const h = parseInt(hi, 16);
  const l = parseInt(lo, 16);
  if (Number.isNaN(h) || Number.isNaN(l)) return null;
  return `${(h >> 8) & 0xff}.${h & 0xff}.${(l >> 8) & 0xff}.${l & 0xff}`;
}

function embeddedIPv4(h: string, re: RegExp): string | null {
  const m = h.match(re);
  if (!m) return null;
  if (m[3]) return m[3]; // already-dotted capture
  return hexGroupsToDotted(m[1], m[2]);
}

// True if a.b.c.d falls in a private/loopback/link-local/CGNAT range.
function isBlockedIPv4Octets(a: number, b: number): boolean {
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;           // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  return false;
}

function isBlockedDottedQuad(host: string): boolean {
  const m = host.match(DOTTED_QUAD_RE);
  if (!m) return false;
  return isBlockedIPv4Octets(Number(m[1]), Number(m[2]));
}

// Block private/loopback/link-local hosts. Handles plain hostnames, dotted-quad
// IPv4 (already normalized by `new URL()` from decimal/hex/short forms), and
// IPv6 literals — including IPv4-mapped and NAT64 addresses that smuggle a
// blocked IPv4 target inside an IPv6 literal.
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;

  // IPv6 rules apply ONLY to IPv6 literals (always contain ':'). Testing these
  // prefixes against bare hostnames blocks real domains: fcuk.com (French
  // Connection UK, an actual apparel brand in this catalog's space), fdny.org,
  // anything starting fc/fd.
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
    const embedded = embeddedIPv4(h, IPV4_MAPPED_RE) ?? embeddedIPv4(h, NAT64_RE);
    if (embedded && isBlockedDottedQuad(embedded)) return true;
    return false;
  }

  return isBlockedDottedQuad(h);
}

// Parse + validate a candidate URL: https-only, host not blocked. Returns the
// parsed URL on success, null otherwise (caller treats null as "never fetched").
export function urlAllowed(u: string): URL | null {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:') return null;
    if (isBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch { return null; }
}

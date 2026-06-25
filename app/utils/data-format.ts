// Small pure formatting/parsing helpers for the admin Data surface. Extracted
// from app/routes/admin/data.tsx (god-file split #8) — no React, easy to test.

/** Read a JSON-array localStorage value back into a Set (empty on miss/parse
 *  error). Generic over the element type. */
export function readLocalSet<T extends string | number>(key: string): Set<T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

/** Persist a Set as a JSON array under `key` (no-op on quota errors). */
export function writeLocalSet(key: string, set: Set<string | number>) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* quota */ }
}

/** Pull a deduped list of http(s) URLs out of a free-text blob (paste of one
 *  or many product links), stripping trailing punctuation that isn't part of
 *  the URL. */
export function extractUrls(raw: string): string[] {
  if (!raw) return [];
  const matches = raw.match(/https?:\/\/[^\s,;'"<>()]+/gi) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    // Strip trailing punctuation that's not part of a URL.
    const cleaned = m.replace(/[.,;:!?)]+$/, '');
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

// Compact, unambiguous date format that's friendly to scan.
// Recent dates use a relative phrase ("3h ago", "Yesterday", "Mon");
// anything older falls back to "May 19" (current year) or "May 19, 2025"
// (older years). The old DD/MM/YY format was ambiguous against MM/DD/YY
// and unreadable at a glance.
export function formatDateAdded(iso: string | null | undefined): string {
  if (!iso) return ' - ';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ' - ';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  // Future timestamps (clock skew, server-ahead) read awkwardly as
  // negative — clamp to "just now".
  if (diffMs < 0 || diffMs < 90_000) return 'Just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < 12 * hour) return `${Math.floor(diffMs / hour)}h ago`;
  // Within today or yesterday → relative day.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((today.getTime() - dDay.getTime()) / day);
  if (dayDiff === 0) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  // Within current year: "May 19". Older: "May 19, 2025".
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

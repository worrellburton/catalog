// Small pure formatting/parsing helpers for the admin Data surface. Extracted
// from app/routes/admin/data.tsx (god-file split #8) — no React, easy to test.

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

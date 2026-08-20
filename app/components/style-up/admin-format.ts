// Formatting shared by the admin StyleUp surfaces: the conversation index,
// a single conversation, and the generation audit page. Lives here rather than
// in a route module so no route has to import another route, and outside
// app/utils/ so it stays in the `admin` rollup chunk.

export function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function statusClass(s: string): string {
  if (s === 'done') return 'sua-pill sua-pill--done';
  if (s === 'failed') return 'sua-pill sua-pill--failed';
  return 'sua-pill sua-pill--pending';
}

/** Seconds between two timestamps, pretty-printed ("74s" / "2m 3s"). */
export function fmtElapsed(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return '—';
  const s = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return '—';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

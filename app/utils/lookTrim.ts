// Maps a look's video src → its trimmer [start,end] window (seconds). The data
// layer (services/looks.ts) registers windows when a look carries a trim;
// TrailVideoHost.attach() consults it to loop that window on the pooled video.
// Absence means "play the whole clip" — so untrimmed looks are unaffected.

const lookTrimBySrc = new Map<string, { start: number; end: number | null }>();

export function registerLookTrim(src: string | undefined, start?: number, end?: number): void {
  if (!src) return;
  if (start == null && end == null) { lookTrimBySrc.delete(src); return; }
  lookTrimBySrc.set(src, { start: start ?? 0, end: end ?? null });
}

export function getLookTrim(src: string): { start: number; end: number | null } | undefined {
  return lookTrimBySrc.get(src);
}

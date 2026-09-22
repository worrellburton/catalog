// Long-form "posted on" date for consumer surfaces (the look page head row).

/** "September 3, 2026" in the viewer's locale; '' when missing or invalid. */
export function formatPostedDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

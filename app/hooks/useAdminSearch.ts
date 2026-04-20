import { useSearchParams } from '@remix-run/react';

// Returns the current admin topbar query (?q=...) as a trimmed lowercase
// string. Pages opt into live filtering by reading this and applying it
// to their visible data.
export function useAdminSearch(): string {
  const [params] = useSearchParams();
  return (params.get('q') || '').trim().toLowerCase();
}

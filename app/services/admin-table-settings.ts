import { supabase } from '~/utils/supabase';

/**
 * Cross-admin shared table preferences. The /admin/data Products
 * table (and any other admin table opting in) reads and writes its
 * sort state through here so when one admin clicks a column header,
 * every other admin's open page picks up the same sort order via the
 * realtime channel below.
 *
 * Persistence lives in `app_settings` keyed by a string like
 * `admin:table_sort:products`. Value is a JSON object:
 *   { key: string; direction: 'asc' | 'desc' } | null
 * Null means "no sort applied" (the third click on a header). We
 * serialize via JSON.stringify because app_settings.value is text.
 */

export type SortDirection = 'asc' | 'desc';
export interface SharedSortState {
  key: string;
  direction: SortDirection;
}

const PREFIX = 'admin:table_sort:';

function settingKey(tableId: string): string {
  return `${PREFIX}${tableId}`;
}

export async function getSharedSort(tableId: string): Promise<SharedSortState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', settingKey(tableId))
    .maybeSingle();
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(data.value as string);
    if (parsed && typeof parsed === 'object' && typeof parsed.key === 'string'
        && (parsed.direction === 'asc' || parsed.direction === 'desc')) {
      return { key: parsed.key, direction: parsed.direction };
    }
  } catch { /* corrupt value — fall through to null */ }
  return null;
}

export async function setSharedSort(
  tableId: string,
  state: SharedSortState | null,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const value = state ? JSON.stringify(state) : JSON.stringify(null);
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key: settingKey(tableId), value, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  return { error: error?.message ?? null };
}

/**
 * Subscribe to realtime updates on the shared sort row for one table.
 * Caller gets every change after their own write too — components
 * dedupe via shallow equality before calling setState.
 */
export function subscribeSharedSort(
  tableId: string,
  onChange: (next: SharedSortState | null) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`admin-table-sort:${tableId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${settingKey(tableId)}` },
      (payload) => {
        const row = (payload.new ?? payload.old) as { value?: string } | undefined;
        if (!row || row.value == null) { onChange(null); return; }
        try {
          const parsed = JSON.parse(row.value as string);
          if (parsed === null) { onChange(null); return; }
          if (parsed && typeof parsed.key === 'string'
              && (parsed.direction === 'asc' || parsed.direction === 'desc')) {
            onChange({ key: parsed.key, direction: parsed.direction });
          }
        } catch { /* corrupt payload — ignore */ }
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

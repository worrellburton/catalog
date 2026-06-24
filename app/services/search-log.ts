import { supabase } from '~/utils/supabase';

// Search-log batching. The consumer feed used to fire one Supabase insert
// per debounced query - for a user typing "white shoes nike" with pauses,
// that's three separate POST round trips. We now queue entries client-side
// and flush them as a single call to the search-log-batch edge function
// either every 5 s, or on page unload, or when the queue hits 16 entries
// (whichever first). Same rows on the server, ~3× fewer requests.

export interface SearchLogEntry {
  query: string;
  user_handle: string;
  results_count: number;
  clicked: boolean;
  filter: string;
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT_SIZE = 16;

const queue: SearchLogEntry[] = [];
let flushTimer: number | null = null;

// Click tracking. Search rows are batched fire-and-forget (no row id comes
// back, no UPDATE path), so we record a click as client state keyed on
// handle+query and apply it where the row is still mutable:
//   1. flip a matching entry that's still in the queue (not yet flushed), and
//   2. seed `clicked` when logSearch enqueues — catches a tile-open that
//      landed BEFORE the 2.5 s debounce fired the log.
// A click after the row already flushed to the DB is dropped (best-effort).
const clickedKeys = new Set<string>();
const keyOf = (query: string, handle: string) => `${handle}\n${query}`;

// Called when a shopper opens any tile while a search is active. Query must
// be normalized the same way logSearch's caller normalizes it (trim+lower).
export function markSearchClicked(query: string, user_handle: string): void {
  const q = query.trim().toLowerCase();
  if (!q || !user_handle) return;
  clickedKeys.add(keyOf(q, user_handle));
  for (const e of queue) {
    if (e.user_handle === user_handle && e.query === q) e.clicked = true;
  }
}

async function flush(): Promise<void> {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  if (!supabase) return;
  // Drain the queue first so concurrent enqueues during the await don't
  // get re-sent or lost.
  const entries = queue.splice(0, queue.length);
  try {
    const { error } = await supabase.functions.invoke('search-log-batch', {
      body: { entries },
    });
    if (error) console.error('[search-log] batch flush failed:', error.message);
  } catch (err) {
    // Network blip - we drop these rather than retry indefinitely. Search
    // logging is best-effort analytics, not a billable side-effect.
    console.error('[search-log] batch flush threw:', err);
  }
}

export function logSearch(entry: SearchLogEntry): void {
  if (!entry.query || !entry.user_handle) return;
  // A click may have arrived before this debounced log fired.
  if (clickedKeys.has(keyOf(entry.query, entry.user_handle))) entry.clicked = true;
  // Prefix-collapse a continuous typing chain within the flush window so
  // only the FINAL/longest query of a refinement lands as a row. Typing
  // "i need" → "i need a dress" → "i need a dress for a wedding" with
  // ~1.5 s pauses used to enqueue THREE rows (each became its own
  // "catalog"); now the queue keeps just the longest.
  //
  // Compare per user_handle so one shopper's refinement never swallows
  // another shopper's queued query.
  const q = entry.query;
  for (let i = 0; i < queue.length; i++) {
    const existing = queue[i];
    if (existing.user_handle !== entry.user_handle) continue;
    // The new query extends a queued one (forward typing) → replace the
    // shorter entry with the longer, keeping the latest counts/filter.
    if (q.length > existing.query.length && q.startsWith(existing.query)) {
      // Carry a click on the shorter query forward to the surviving longer one.
      if (existing.clicked) entry.clicked = true;
      queue[i] = entry;
      // No new push, no size/timer change — we swapped in place.
      return;
    }
    // The new query is a prefix of a queued one (backspace / shorter
    // pause that already has a longer sibling queued) → skip enqueuing.
    if (existing.query.startsWith(q)) {
      return;
    }
  }
  queue.push(entry);
  if (queue.length >= FLUSH_AT_SIZE) {
    void flush();
    return;
  }
  if (flushTimer == null && typeof window !== 'undefined') {
    flushTimer = window.setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

// Best-effort flush on tab close so any queued entries don't get lost.
// pagehide is the only event reliably fired across mobile + desktop +
// tab-discard scenarios.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flush(); });
}

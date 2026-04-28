// search-log-batch — accepts an array of search-log entries and inserts
// them in one round trip. The client batches multiple debounced queries
// (e.g. "white", "white shoes", "white shoes nike") and flushes the
// whole queue on page unload or every 5 seconds, whichever first.
//
// Uses the service role to bypass RLS — anonymous search logging is
// fine to capture without the user being signed in. We do basic input
// sanity checks (cap on payload size, query length) so a malicious
// client can't dump unbounded rows.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface LogEntry {
  query: string;
  user_handle: string;
  results_count?: number;
  clicked?: boolean;
  filter?: string;
}

const MAX_BATCH_SIZE = 50;
const MAX_QUERY_LENGTH = 200;
const MAX_HANDLE_LENGTH = 80;

function sanitize(entries: unknown): LogEntry[] {
  if (!Array.isArray(entries)) return [];
  const out: LogEntry[] = [];
  for (const raw of entries.slice(0, MAX_BATCH_SIZE)) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const query = typeof e.query === 'string' ? e.query.slice(0, MAX_QUERY_LENGTH).trim() : '';
    const user_handle = typeof e.user_handle === 'string' ? e.user_handle.slice(0, MAX_HANDLE_LENGTH) : '';
    if (!query || !user_handle) continue;
    out.push({
      query,
      user_handle,
      results_count: typeof e.results_count === 'number' ? e.results_count : 0,
      clicked: typeof e.clicked === 'boolean' ? e.clicked : false,
      filter: typeof e.filter === 'string' ? e.filter.slice(0, 32) : 'all',
    });
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonRes({ success: false, error: 'Method not allowed' }, 405);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonRes({ success: false, error: 'Invalid JSON' }, 400);
  }

  const entries = sanitize((payload as { entries?: unknown })?.entries);
  if (entries.length === 0) {
    // Empty batch is fine — caller flushed an empty queue on unload.
    return jsonRes({ success: true, inserted: 0 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const client = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await client.from('search_logs').insert(entries);
  if (error) {
    return jsonRes({ success: false, error: error.message }, 500);
  }

  return jsonRes({ success: true, inserted: entries.length });
});

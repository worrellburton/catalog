// Global generation queue — the single pub/sub bus every AI generation
// in the app reports to (polish, primary video, look generation, style
// generation, …). The GenerationQueueHost (mounted at app root) renders
// a floating panel that shows every in-flight job with a progress bar
// driven by a rolling-average ETA per-kind. Persists the average across
// reloads in localStorage so the first job after a refresh still has a
// realistic estimate.

export type GenerationKind =
  | 'polish'           // nano-banana / Gemini reframe to 4:5
  | 'primary-video'    // Seedance i2v from primary image
  | 'pick-primary'     // Claude vision picking the cleanest solo image
  | 'look'             // generate-look full pipeline
  | 'style'            // generate-style fan-out
  | 'creative'         // promoteQueuedAds / createBatchAds
  | 'other';

export interface GenerationJob {
  id: string;
  kind: GenerationKind;
  label: string;        // human title ("Polish — James Perse sweater")
  /** Optional sub-text ("Lululemon · Pants"). */
  context?: string;
  /** Human model label rendered as a chip next to context
   *  ("Gemini 2.5 Flash · nano-banana", "Seedance 2 Pro"). */
  model?: string;
  /** Optional thumbnail URL — when present, rendered alongside the bar. */
  thumbnailUrl?: string | null;
  startedAt: number;    // ms
  estimatedMs: number;  // rolling avg per kind at start; bar clamps to 0–100% of this
  status: 'running' | 'done' | 'failed';
  /** Final result message ("Polished", "Failed: timeout_60000ms"). */
  resultMessage?: string;
  endedAt?: number;
}

import { supabase } from '~/utils/supabase';

type Listener = () => void;

const listeners = new Set<Listener>();
const jobs = new Map<string, GenerationJob>();

// ── Cross-user mirror ────────────────────────────────────────────────
// Every started job is also written to public.generation_jobs so admins
// (and the owner) can see it live via realtime in GenerationQueueHost.
// We remember the DB ids WE created this session so the host can filter
// them out of the realtime stream (they're already shown from the local
// in-memory bus — no double render).
const ownDbJobIds = new Set<string>();
export function isOwnDbJob(id: string): boolean { return ownDbJobIds.has(id); }

async function insertDbJob(input: {
  kind: GenerationKind; label: string; context?: string; model?: string;
  thumbnailUrl?: string | null; estimatedMs?: number;
}): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id ?? null;
    const { data, error } = await supabase
      .from('generation_jobs')
      .insert({
        user_id: uid,
        kind: input.kind,
        label: input.label,
        context: input.context ?? null,
        model: input.model ?? null,
        thumbnail_url: input.thumbnailUrl ?? null,
        estimated_ms: input.estimatedMs ?? getAverageDurationMs(input.kind),
        status: 'running',
      })
      .select('id')
      .single();
    if (error || !data) return null;
    ownDbJobIds.add((data as { id: string }).id);
    return (data as { id: string }).id;
  } catch { return null; }
}

async function closeDbJob(dbId: string | null, status: 'done' | 'failed', message?: string): Promise<void> {
  if (!supabase || !dbId) return;
  try {
    await supabase.from('generation_jobs')
      .update({ status, ended_at: new Date().toISOString(), result_message: message ?? null })
      .eq('id', dbId);
  } catch { /* best-effort */ }
}

// Rolling averages per kind. EMA (alpha=0.4) — recent runs weigh more
// without thrashing. Seeded from sensible defaults + localStorage.
const AVG_LS_KEY = 'catalog:gen-avgs:v1';
const DEFAULT_AVGS: Record<GenerationKind, number> = {
  'polish':         9_000,   // observed ~8–10s for Gemini 2.5 Flash Image at 1K
  'primary-video':  90_000,  // Seedance 2.0 720p / 5s
  'pick-primary':   4_500,
  'look':           110_000,
  'style':          18_000,
  'creative':       6_000,
  'other':          10_000,
};
function loadAvgs(): Record<GenerationKind, number> {
  if (typeof window === 'undefined') return { ...DEFAULT_AVGS };
  try {
    const raw = window.localStorage.getItem(AVG_LS_KEY);
    if (!raw) return { ...DEFAULT_AVGS };
    const parsed = JSON.parse(raw) as Partial<Record<GenerationKind, number>>;
    return { ...DEFAULT_AVGS, ...parsed };
  } catch { return { ...DEFAULT_AVGS }; }
}
// Live running averages — declared right after loadAvgs (and before saveAvgs)
// so it's never a forward-ref (TDZ chunk-order safety).
const avgs = loadAvgs();
function saveAvgs(avgs: Record<GenerationKind, number>) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(AVG_LS_KEY, JSON.stringify(avgs)); } catch { /* quota */ }
}

function emit() {
  for (const l of listeners) { try { l(); } catch { /* ignore one bad subscriber */ } }
}

export function subscribeGenerationQueue(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function listGenerationJobs(): GenerationJob[] {
  return Array.from(jobs.values()).sort((a, b) => a.startedAt - b.startedAt);
}

export function getAverageDurationMs(kind: GenerationKind): number {
  return avgs[kind] ?? DEFAULT_AVGS[kind] ?? 10_000;
}

// Start a job. Returns helpers to finish/fail it, plus the job id.
export function startGenerationJob(input: {
  kind: GenerationKind;
  label: string;
  context?: string;
  model?: string;
  thumbnailUrl?: string | null;
  /** Optional explicit override — otherwise the rolling avg is used. */
  estimatedMs?: number;
}): {
  id: string;
  finish: (observedMs?: number, resultMessage?: string) => void;
  fail: (resultMessage?: string) => void;
} {
  const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: GenerationJob = {
    id,
    kind: input.kind,
    label: input.label,
    context: input.context,
    model: input.model,
    thumbnailUrl: input.thumbnailUrl ?? null,
    startedAt: Date.now(),
    estimatedMs: input.estimatedMs ?? getAverageDurationMs(input.kind),
    status: 'running',
  };
  jobs.set(id, job);
  emit();
  // Mirror to the DB (fire-and-forget). finish/fail resolve the id first
  // so the row gets closed even if the insert is still in flight.
  const dbIdPromise = insertDbJob(input);
  return {
    id,
    finish: (observedMs?: number, resultMessage?: string) => {
      const j = jobs.get(id);
      if (!j) return;
      j.status = 'done';
      j.endedAt = Date.now();
      j.resultMessage = resultMessage;
      void dbIdPromise.then(dbId => closeDbJob(dbId, 'done', resultMessage));
      // Roll the actual duration into the kind's average (EMA, a=0.4).
      const actual = typeof observedMs === 'number' && observedMs > 0
        ? observedMs : (j.endedAt - j.startedAt);
      avgs[j.kind] = Math.round((avgs[j.kind] ?? DEFAULT_AVGS[j.kind]) * 0.6 + actual * 0.4);
      saveAvgs(avgs);
      emit();
      // Auto-remove finished jobs after a beat so the panel stays focused
      // on what's running, but the success/fail row is visible long
      // enough to be noticed.
      window.setTimeout(() => {
        jobs.delete(id);
        emit();
      }, j.status === 'done' ? 2500 : 5000);
    },
    fail: (resultMessage?: string) => {
      const j = jobs.get(id);
      if (!j) return;
      j.status = 'failed';
      j.endedAt = Date.now();
      j.resultMessage = resultMessage;
      void dbIdPromise.then(dbId => closeDbJob(dbId, 'failed', resultMessage));
      emit();
      window.setTimeout(() => { jobs.delete(id); emit(); }, 5000);
    },
  };
}

/**
 * Mark a running local job as failed by id. Mirrors the .fail()
 * closure returned by startGenerationJob, but reachable from
 * surfaces that didn't start the job (e.g. the queue popover's
 * cancel button). No-op if the id isn't a tracked local job —
 * scrape + creative cancels go through their own DB updates.
 */
export function cancelGenerationJobById(id: string, resultMessage = 'Cancelled'): void {
  const j = jobs.get(id);
  if (!j || j.status !== 'running') return;
  j.status = 'failed';
  j.endedAt = Date.now();
  j.resultMessage = resultMessage;
  emit();
  window.setTimeout(() => { jobs.delete(id); emit(); }, 5000);
}

/** Test-only helper. */
export function _resetGenerationQueue() {
  jobs.clear();
  emit();
}

// Running jobs from OTHER sessions/users, streamed from the DB. RLS means
// an admin receives everyone's rows (the site-wide view) while a normal
// user receives only their own — which are already shown by the local
// bus, so they're filtered out via ownDbJobIds. Stale running rows
// (client crashed mid-job) are dropped after 10 min.
const EXTERNAL_STALE_MS = 10 * 60 * 1000;
type DbJobRow = {
  id: string; kind: GenerationKind; label: string; context: string | null;
  model: string | null; thumbnail_url: string | null; status: string;
  estimated_ms: number | null; started_at: string;
};
function rowToJob(r: DbJobRow): GenerationJob {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    context: r.context ?? undefined,
    model: r.model ?? undefined,
    thumbnailUrl: r.thumbnail_url ?? null,
    startedAt: new Date(r.started_at).getTime(),
    estimatedMs: r.estimated_ms ?? getAverageDurationMs(r.kind),
    status: 'running',
  };
}

export function subscribeExternalGenerationJobs(cb: (jobs: GenerationJob[]) => void): () => void {
  if (!supabase) return () => {};
  const rows = new Map<string, DbJobRow>();
  const push = () => {
    const now = Date.now();
    const out: GenerationJob[] = [];
    for (const r of rows.values()) {
      if (r.status !== 'running') continue;
      if (ownDbJobIds.has(r.id)) continue;
      if (now - new Date(r.started_at).getTime() > EXTERNAL_STALE_MS) continue;
      out.push(rowToJob(r));
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    cb(out);
  };
  supabase
    .from('generation_jobs')
    .select('id, kind, label, context, model, thumbnail_url, status, estimated_ms, started_at')
    .eq('status', 'running')
    .gte('started_at', new Date(Date.now() - EXTERNAL_STALE_MS).toISOString())
    .order('started_at', { ascending: false })
    .limit(40)
    .then(({ data }) => {
      for (const r of (data as DbJobRow[] | null) ?? []) rows.set(r.id, r);
      push();
    });
  const ch = supabase
    .channel('generation_jobs_stream')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'generation_jobs' }, (payload) => {
      const rec = (payload.new ?? payload.old) as Partial<DbJobRow> | undefined;
      if (!rec?.id) return;
      if (payload.eventType === 'DELETE') rows.delete(rec.id);
      else rows.set(rec.id, rec as DbJobRow);
      push();
    })
    .subscribe();
  return () => { void supabase!.removeChannel(ch); };
}

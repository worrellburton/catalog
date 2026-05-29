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

type Listener = () => void;

const listeners = new Set<Listener>();
const jobs = new Map<string, GenerationJob>();

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
function saveAvgs(avgs: Record<GenerationKind, number>) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(AVG_LS_KEY, JSON.stringify(avgs)); } catch { /* quota */ }
}
const avgs = loadAvgs();

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
  return {
    id,
    finish: (observedMs?: number, resultMessage?: string) => {
      const j = jobs.get(id);
      if (!j) return;
      j.status = 'done';
      j.endedAt = Date.now();
      j.resultMessage = resultMessage;
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
      emit();
      window.setTimeout(() => { jobs.delete(id); emit(); }, 5000);
    },
  };
}

/** Test-only helper. */
export function _resetGenerationQueue() {
  jobs.clear();
  emit();
}

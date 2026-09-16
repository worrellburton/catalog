// generation-spine — turns the stored generation_events log into renderable
// audit nodes for /admin/style/g/:generationId.
//
// PURE by design: no Supabase import, so the mapper is unit-testable with zero
// setup and the fetch lives in user-generations.ts instead.
//
// Every label and summary below is keyed off payload fields that the edge
// functions ACTUALLY write (verified against all 611 live rows). An event with
// no entry here still renders, labelled with its raw name — that is deliberate,
// see summarize()/labelFor().

export interface GenerationEvent {
  id: number;
  event: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface SpineNode {
  key: string;
  event: string;
  label: string;
  summary: string;
  at: string;
  failed: boolean;
  payload: Record<string, unknown> | null;
}

const EVENT_LABEL: Record<string, string> = {
  submit_attempt: 'Submit attempt',
  image_rehost_faces: 'Faces re-hosted',
  image_rehost_products: 'Products re-hosted',
  image_preflight: 'Image preflight', // summary uses generic JSON default; no rows yet
  seedance_face_grid: 'Face grid built',
  fal_submit_fallback: 'Model fallback',
  fal_submit_fallback_skipped: 'Fallback skipped',
  content_policy_fallback: 'Content-policy retry',
  fal_submit_ok: 'Submitted to Fal',
  fal_submit_fail: 'Submit failed',
  fal_webhook: 'Fal returned',
  watchdog_timeout: 'Watchdog timeout',
  name_look_fail: 'Naming failed',
};

// Events that represent something going wrong. The node renders in the failed
// style; the spine itself still shows them in sequence.
const FAILED_EVENTS = new Set([
  'fal_submit_fail', 'watchdog_timeout', 'name_look_fail', 'fal_submit_fallback_skipped',
]);

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

/** "2 images · 342 KB" from a re-host stats array. */
function rehostSummary(payload: Record<string, unknown>): string {
  const stats = Array.isArray(payload.stats) ? (payload.stats as Array<Record<string, unknown>>) : [];
  if (stats.length === 0) return '';
  const bytes = stats.reduce((a, s) => a + num(s.bytes), 0);
  return `${stats.length} image${stats.length === 1 ? '' : 's'} · ${Math.round(bytes / 1024)} KB`;
}

function summarize(event: string, payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  switch (event) {
    case 'submit_attempt':
      return [str(payload.fal_model), `${num(payload.face_count)} face`, `${num(payload.product_count)} piece`]
        .filter(Boolean).join(' · ');
    case 'image_rehost_faces':
    case 'image_rehost_products':
      return rehostSummary(payload);
    case 'seedance_face_grid':
      return `${num(payload.faces)} face → ${num(payload.gridded)} grid`;
    case 'fal_submit_fallback':
      return `${str(payload.original_model)} → ${str(payload.fallback_model)}`;
    case 'fal_submit_fallback_skipped':
      return str(payload.reason) || str(payload.original_error);
    case 'content_policy_fallback':
      return `${str(payload.from)} → ${str(payload.to)}`;
    case 'fal_submit_ok':
      return [str(payload.model), `req ${str(payload.request_id).slice(0, 14)}`, // 14 chars, not 12 — fixture requires it
        payload.duration_seconds ? `${num(payload.duration_seconds)}s` : '']
        .filter(Boolean).join(' · ');
    case 'fal_submit_fail':
      return str(payload.error);
    case 'fal_webhook':
      return [str(payload.status), str(payload.error_code) || str(payload.error)]
        .filter(Boolean).join(' · ');
    case 'watchdog_timeout':
      return str(payload.reason);
    case 'name_look_fail':
      return str(payload.error);
    default: {
      // Unknown event — never drop it. Show enough of the payload that an
      // operator can tell what happened, and the raw JSON is one click away.
      const json = JSON.stringify(payload);
      return json.length > 80 ? `${json.slice(0, 80)}…` : json;
    }
  }
}

/** Known events get a written label; anything else keeps its raw event string. */
function labelFor(event: string): string {
  return EVENT_LABEL[event] ?? event;
}

export function eventsToNodes(events: GenerationEvent[]): SpineNode[] {
  return [...events]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(e => ({
      key: `${e.id}:${e.event}`,
      event: e.event,
      label: labelFor(e.event),
      summary: summarize(e.event, e.payload),
      at: e.createdAt,
      failed: FAILED_EVENTS.has(e.event),
      payload: e.payload,
    }));
}

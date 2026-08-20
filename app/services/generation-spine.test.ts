import { describe, it, expect } from 'vitest';
import { eventsToNodes, type GenerationEvent } from './generation-spine';

const ev = (event: string, payload: Record<string, unknown> | null, at: string): GenerationEvent =>
  ({ id: 1, event, payload, createdAt: at });

describe('eventsToNodes (generation audit spine)', () => {
  it('maps a known event to its label and a payload-derived summary', () => {
    const [n] = eventsToNodes([
      ev('fal_submit_ok', { request_id: 'req_8f2a1c4b9d0e', model: 'bytedance/seedance-2.5', duration_seconds: 10 }, '2026-08-14T15:58:53Z'),
    ]);
    expect(n.label).toBe('Submitted to Fal');
    expect(n.summary).toContain('bytedance/seedance-2.5');
    expect(n.summary).toContain('req_8f2a1c4b9d');
    expect(n.failed).toBe(false);
  });

  it('still renders an UNKNOWN event rather than dropping it', () => {
    // The guarantee: a new event type added to an edge function shows up in the
    // audit without a UI change. Silently dropping it would make the spine lie.
    const [n] = eventsToNodes([ev('some_future_step', { detail: 'hello' }, '2026-08-14T15:58:00Z')]);
    expect(n).toBeDefined();
    expect(n.label).toBe('some_future_step');
    expect(n.summary).toContain('hello');
  });

  it('marks failure events failed', () => {
    const nodes = eventsToNodes([
      ev('fal_submit_fail', { error: 'FAL_KEY missing' }, '2026-08-14T15:58:00Z'),
      ev('watchdog_timeout', { reason: 'no webhook after 15m' }, '2026-08-14T16:13:00Z'),
      ev('name_look_fail', { error: 'timeout' }, '2026-08-14T16:14:00Z'),
    ]);
    expect(nodes.map(n => n.failed)).toEqual([true, true, true]);
    expect(nodes[0].summary).toContain('FAL_KEY missing');
  });

  it('summarises a re-host batch as count plus total size', () => {
    const [n] = eventsToNodes([
      ev('image_rehost_faces', { stats: [{ bytes: 238923 }, { bytes: 111077 }] }, '2026-08-14T15:58:45Z'),
    ]);
    expect(n.label).toBe('Faces re-hosted');
    expect(n.summary).toBe('2 images · 342 KB');
  });

  it('orders by createdAt and gives every node a stable unique key', () => {
    const nodes = eventsToNodes([
      ev('fal_webhook', { status: 'done' }, '2026-08-14T16:03:17Z'),
      ev('submit_attempt', { fal_model: 'm', face_count: 1, product_count: 3 }, '2026-08-14T15:58:42Z'),
    ]);
    expect(nodes.map(n => n.event)).toEqual(['submit_attempt', 'fal_webhook']);
    expect(new Set(nodes.map(n => n.key)).size).toBe(2);
  });

  it('produces no nodes for an empty log, so the page can show its own empty state', () => {
    expect(eventsToNodes([])).toEqual([]);
  });

  it('survives a null payload', () => {
    const [n] = eventsToNodes([ev('seedance_face_grid', null, '2026-08-14T15:58:52Z')]);
    expect(n.label).toBe('Face grid built');
    expect(n.summary).toBe('');
  });

  it('summarises fal_submit_fallback with model transition', () => {
    const [n] = eventsToNodes([
      ev('fal_submit_fallback', { original_model: 'seedance-2.5', fallback_model: 'veo', original_raw_status: 'ERROR' }, '2026-08-14T15:59:00Z'),
    ]);
    expect(n.label).toBe('Model fallback');
    expect(n.summary).toContain('seedance-2.5');
    expect(n.summary).toContain('veo');
  });

  it('summarises fal_submit_fallback_skipped and marks it failed', () => {
    const [n] = eventsToNodes([
      ev('fal_submit_fallback_skipped', { original_model: 'seedance-2.5', reason: 'content policy violation', product_count: 3 }, '2026-08-14T15:59:30Z'),
    ]);
    expect(n.label).toBe('Fallback skipped');
    expect(n.summary).toContain('content policy violation');
    expect(n.failed).toBe(true);
  });

  it('summarises content_policy_fallback with policy transition', () => {
    const [n] = eventsToNodes([
      ev('content_policy_fallback', { from: 'seedance-2.5', to: 'veo', raw: 'policy check failed' }, '2026-08-14T15:59:45Z'),
    ]);
    expect(n.label).toBe('Content-policy retry');
    expect(n.summary).toContain('seedance-2.5');
    expect(n.summary).toContain('veo');
  });

  it('asserts actual summary text for all major event types', () => {
    const nodes = eventsToNodes([
      ev('submit_attempt', { fal_model: 'seedance-2.5', face_count: 2, product_count: 5 }, '2026-08-14T15:58:00Z'),
      ev('seedance_face_grid', { faces: 2, gridded: 8 }, '2026-08-14T15:58:20Z'),
      ev('fal_webhook', { status: 'failed', fal_status: 'ERROR', error_code: 'content_policy' }, '2026-08-14T15:58:50Z'),
      ev('watchdog_timeout', { reason: 'no webhook received within 15 minutes' }, '2026-08-14T16:13:00Z'),
      ev('name_look_fail', { error: 'request timeout' }, '2026-08-14T16:14:00Z'),
    ]);

    expect(nodes[0].summary).toContain('seedance-2.5');
    expect(nodes[0].summary).toContain('2 face');
    expect(nodes[0].summary).toContain('5 piece');

    expect(nodes[1].summary).toContain('2 face');
    expect(nodes[1].summary).toContain('8 grid');

    expect(nodes[2].summary).toContain('failed');
    expect(nodes[2].summary).toContain('content_policy');

    expect(nodes[3].summary).toContain('no webhook received within 15 minutes');

    expect(nodes[4].summary).toContain('request timeout');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_FEED_RULES } from './dials';

// Drift guard: the personalize-feed edge function hand-"mirrors" DEFAULT_RULES
// from this file's DEFAULT_FEED_RULES (the edge fn can't import app code — it
// deploys as a single Deno file). This test fails the build if a feed rule is
// added, removed, or re-tuned in one place but not the other, so the engine
// and the admin dials can never silently disagree.
function parseEdgeDefaults(): Record<string, { enabled: boolean; weight: number }> {
  const src = readFileSync('supabase/functions/personalize-feed/index.ts', 'utf8');
  const block = src.match(/const DEFAULT_RULES: FeedRules = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('DEFAULT_RULES not found in personalize-feed/index.ts');
  const out: Record<string, { enabled: boolean; weight: number }> = {};
  for (const m of block[1].matchAll(/(\w+):\s*\{\s*enabled:\s*(true|false),\s*weight:\s*(\d+)\s*\}/g)) {
    out[m[1]] = { enabled: m[2] === 'true', weight: Number(m[3]) };
  }
  return out;
}

describe('feed-rules parity (client dials ↔ personalize-feed edge fn)', () => {
  const edge = parseEdgeDefaults();

  it('has the same rule keys on both sides', () => {
    expect(Object.keys(edge).sort()).toEqual(Object.keys(DEFAULT_FEED_RULES).sort());
  });

  it('has identical enabled + weight defaults on both sides', () => {
    for (const [k, v] of Object.entries(DEFAULT_FEED_RULES)) {
      expect(edge[k], `rule "${k}" missing in edge DEFAULT_RULES`).toBeDefined();
      expect(edge[k].enabled, `rule "${k}" enabled drift`).toBe(v.enabled);
      expect(edge[k].weight, `rule "${k}" weight drift`).toBe(v.weight);
    }
  });
});

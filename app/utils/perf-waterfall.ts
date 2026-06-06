/**
 * perf-waterfall — a dev-only data-stream waterfall probe.
 *
 * The React/Remix equivalent of a "debug bar" for this stack: it reads the
 * browser Resource Timing API and renders the network waterfall (Supabase
 * REST, storage assets, video, images) with N+1 detection and a serial-wave
 * histogram. Dev-only — tree-shaken out of the production build because every
 * call site is guarded by `import.meta.env.DEV`.
 *
 * Usage (console, once the app is running):
 *   __waterfall()            → snapshot the current page's data-stream waterfall
 *   __waterfall({ all:true}) → include Vite dev module requests (noise)
 *   __waterfallWatch()       → live-stream new requests as they arrive
 *   __waterfallWatch.stop()  → stop the live stream
 *
 * Wire it in (dev only) by adding to app/root.tsx:
 *   if (import.meta.env.DEV) import('~/utils/perf-waterfall');
 */

type Category =
  | 'supabase-rest'
  | 'supabase-storage'
  | 'supabase-auth'
  | 'supabase-fn'
  | 'video'
  | 'image'
  | 'vite-dev-module'
  | 'other';

interface Row {
  cat: Category;
  start: number;
  ms: number;
  kb: number;
  table?: string;
  brand?: string;
  key?: string;
  name: string;
}

const VITE_RE = /\/(@fs|@id|@vite|@react-refresh|__vite|node_modules)/;
const ASSET_RE = /\.(tsx?|jsx?|css|mjs)(\?|$)/;

function categorize(r: PerformanceResourceTiming): Category {
  const u = r.name;
  if (u.includes('supabase.co/rest')) return 'supabase-rest';
  if (u.includes('supabase.co/auth')) return 'supabase-auth';
  if (u.includes('supabase.co/functions')) return 'supabase-fn';
  if (u.includes('supabase.co/storage')) return 'supabase-storage';
  if (/\.(mp4|webm|m4v|mov)(\?|$)/i.test(u) || r.initiatorType === 'video') return 'video';
  if (/\.(jpg|jpeg|png|webp|avif|gif|svg)(\?|$)/i.test(u) || r.initiatorType === 'img') return 'image';
  if (VITE_RE.test(u) || ASSET_RE.test(u) || u.includes('/.vite/')) return 'vite-dev-module';
  return 'other';
}

function toRow(r: PerformanceResourceTiming): Row {
  const cat = categorize(r);
  let table: string | undefined;
  let brand: string | undefined;
  let key: string | undefined;
  try {
    const url = new URL(r.name);
    if (cat === 'supabase-rest') {
      table = url.pathname.replace('/rest/v1/', '');
      brand = url.searchParams.get('brand')?.replace(/^eq\./, '') || undefined;
      key = url.searchParams.get('key')?.replace(/^eq\./, '') || undefined;
    }
  } catch {
    /* relative URL — ignore */
  }
  return {
    cat,
    start: Math.round(r.startTime),
    ms: Math.round(r.duration),
    kb: Math.round((r.transferSize || r.encodedBodySize || 0) / 1024),
    table,
    brand,
    key,
    name: r.name,
  };
}

/** Group repeated REST tables — surfaces N+1 query fan-out. */
function detectNPlusOne(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.cat !== 'supabase-rest' || !r.table) continue;
    counts[r.table] = (counts[r.table] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1]),
  );
}

/** Bucket request start times into 100ms windows — surfaces serial waves. */
function waveHistogram(rows: Row[]): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const r of rows) {
    if (r.cat === 'vite-dev-module') continue;
    const w = `${Math.floor(r.start / 100) * 100}ms`;
    buckets[w] = (buckets[w] || 0) + 1;
  }
  return buckets;
}

function summarize(rows: Row[]) {
  const byCat: Record<string, { count: number; kb: number; totalMs: number; maxMs: number }> = {};
  for (const r of rows) {
    const g = (byCat[r.cat] ||= { count: 0, kb: 0, totalMs: 0, maxMs: 0 });
    g.count++;
    g.kb += r.kb;
    g.totalMs += r.ms;
    g.maxMs = Math.max(g.maxMs, r.ms);
  }
  return byCat;
}

export interface WaterfallOptions {
  /** Include Vite dev-server module requests (dev noise). Default false. */
  all?: boolean;
}

/** Snapshot the current page's data-stream waterfall to the console. */
export function waterfall(opts: WaterfallOptions = {}) {
  const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const rows = res.map(toRow).sort((a, b) => a.start - b.start);
  const real = rows.filter((r) => r.cat !== 'vite-dev-module');
  const shown = opts.all ? rows : real;

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;

  /* eslint-disable no-console */
  console.group('%c📊 data-stream waterfall', 'font-weight:bold;font-size:13px');
  console.log('timing', {
    ttfb: Math.round(nav?.responseStart || 0),
    fcp: fcp ? Math.round(fcp) : undefined,
    domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
    load: Math.round(nav?.loadEventEnd || 0),
  });
  console.log('byCategory', summarize(rows));
  const np = detectNPlusOne(real);
  if (Object.keys(np).length) console.warn('⚠️  repeated REST tables (possible N+1):', np);
  console.log('start-time histogram (100ms) — clustered waves = serial dependency:', waveHistogram(real));
  console.table(
    shown.map((r) => ({
      start: `${r.start}ms`,
      dur: `${r.ms}ms`,
      cat: r.cat,
      kb: r.kb || '',
      detail: r.table ? `${r.table}${r.brand ? ` brand=${r.brand}` : ''}${r.key ? ` key=${r.key}` : ''}` : r.name.slice(-60),
    })),
  );
  console.groupEnd();
  /* eslint-enable no-console */

  return { rows: shown, byCategory: summarize(rows), nPlusOne: np };
}

let observer: PerformanceObserver | null = null;

/** Live-stream new data requests as they arrive (the "waterfall" in motion). */
export function waterfallWatch() {
  if (observer) return;
  observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries() as PerformanceResourceTiming[]) {
      const r = toRow(e);
      if (r.cat === 'vite-dev-module') continue;
      // eslint-disable-next-line no-console
      console.log(`%c+${r.start}ms %c${r.cat} %c${r.ms}ms`, 'color:#888', 'color:#6cf', 'color:#fc6',
        r.table ? `${r.table}${r.brand ? ` brand=${r.brand}` : ''}${r.key ? ` key=${r.key}` : ''}` : r.name.slice(-70));
    }
  });
  observer.observe({ type: 'resource', buffered: false });
  // eslint-disable-next-line no-console
  console.log('%c▶ watching data stream… call __waterfallWatch.stop() to end', 'color:#6f6');
}
waterfallWatch.stop = () => {
  observer?.disconnect();
  observer = null;
};

// Self-install on the window in dev so it's reachable from the console.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__waterfall = waterfall;
  (window as unknown as Record<string, unknown>).__waterfallWatch = waterfallWatch;
}

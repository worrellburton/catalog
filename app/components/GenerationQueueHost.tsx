// Global generation-queue host. A floating circle in the lower-right (always
// visible) that opens a tabbed panel (Active / History / Failed) covering
// every kind of long-running job in the app:
//
//  • Local AI gens (polish / primary-video / pick-primary / generate-look …)
//    via the in-memory generation-queue bus
//  • Cross-user gens (admins see everyone's; users see their own) via the
//    generation_jobs table realtime stream
//  • Admin AI ad pipeline (product_creative queued/pending/generating/failed)
//    so admins see Seedance / Veo runs in the same place — this is the data
//    that used to live in the admin nav-bar bell (now retired).
//  • Product scrapes (products.scrape_status) so admins watch crawler runs
//    alongside generations.
//
// Empty state: the circle still renders but dim — it's the persistent
// entry point. With anything active it pulses + shows a count badge.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from '@remix-run/react';
import {
  listGenerationJobs,
  subscribeGenerationQueue,
  subscribeExternalGenerationJobs,
  type GenerationJob,
} from '~/services/generation-queue';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';

type Tab = 'active' | 'history' | 'failed';

interface QueueItem {
  id: string;
  source: 'gen' | 'scrape' | 'creative';
  label: string;
  context?: string;
  model?: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  endedAt?: number;
  estimatedMs: number;
  thumbnailUrl?: string | null;
  resultMessage?: string;
}

// Defaults for the rolling-ETA bars on non-gen sources. Scrapes typically
// take 6–20s on Modal; product_creative video gens are minutes — these are
// just visual bar speeds, they don't gate completion.
const SCRAPE_EST_MS = 18_000;
const CREATIVE_EST_MS = 80_000;

const HISTORY_WINDOW_MS = 60 * 60 * 1000; // last hour worth of completed/failed

function genJobToItem(j: GenerationJob): QueueItem {
  return {
    id: j.id,
    source: 'gen',
    label: j.label,
    context: j.context,
    model: j.model,
    status: j.status,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    estimatedMs: j.estimatedMs,
    thumbnailUrl: j.thumbnailUrl ?? null,
    resultMessage: j.resultMessage,
  };
}

// Admin-route only. The queue is the right surface for admin pages
// (gen jobs, scrapes, creative pipeline) but it visually intrudes on
// the consumer feed even when the viewer happens to be signed in as an
// admin — admins shop too. Gate by route, not just role, so the same
// admin sees the queue on /admin/* and a clean consumer landing on /.
// Pages outside /admin (including super-admin's view of /) never even
// mount the inner host, so no subscriptions / polling fire there.
export default function GenerationQueueHost() {
  const { user } = useAuth();
  const location = useLocation();
  const role = user?.role;
  const isAdmin = role === 'admin' || role === 'super_admin';
  const onAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  if (!isAdmin || !onAdminRoute) return null;
  return <AdminGenerationQueueHost />;
}

function AdminGenerationQueueHost() {
  const [localJobs, setLocalJobs] = useState<GenerationJob[]>(listGenerationJobs());
  const [externalJobs, setExternalJobs] = useState<GenerationJob[]>([]);
  const [scrapeItems, setScrapeItems] = useState<QueueItem[]>([]);
  const [creativeItems, setCreativeItems] = useState<QueueItem[]>([]);
  const [now, setNow] = useState(Date.now());
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const panelRef = useRef<HTMLDivElement>(null);

  // ── In-app gen jobs (local bus) + cross-user gen jobs (realtime) ──
  useEffect(() => subscribeGenerationQueue(() => setLocalJobs(listGenerationJobs())), []);
  useEffect(() => subscribeExternalGenerationJobs(setExternalJobs), []);

  // ── Product scrapes via lightweight polling ───────────────────────
  // The `products` table isn't on the realtime publication and we don't want
  // to add 800+ rows of churn to it. Polling every 5s for the small slice of
  // pending/processing rows (plus anything recently completed/failed) is
  // ~1 cheap indexed query per tick.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const pull = async () => {
      const since = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
      const { data } = await supabase!
        .from('products')
        .select('id, name, brand, scrape_status, created_at, scraped_at, scrape_error, image_url, primary_image_url')
        .or(`scrape_status.in.(pending,processing),and(scrape_status.in.(done,failed),scraped_at.gte.${since})`)
        .order('scraped_at', { ascending: false, nullsFirst: false })
        .limit(50);
      if (cancelled) return;
      type Row = {
        id: string; name: string | null; brand: string | null;
        scrape_status: 'pending' | 'processing' | 'done' | 'failed';
        created_at: string; scraped_at: string | null; scrape_error: string | null;
        image_url: string | null; primary_image_url: string | null;
      };
      const items: QueueItem[] = ((data as Row[] | null) || []).map(r => ({
        id: `scrape-${r.id}`,
        source: 'scrape',
        label: r.name || 'Scraping product…',
        context: r.brand || undefined,
        model: 'Modal · Playwright',
        status: r.scrape_status === 'pending' || r.scrape_status === 'processing'
          ? 'running' : r.scrape_status === 'done' ? 'done' : 'failed',
        startedAt: new Date(r.created_at).getTime(),
        endedAt: r.scraped_at ? new Date(r.scraped_at).getTime() : undefined,
        estimatedMs: SCRAPE_EST_MS,
        thumbnailUrl: r.primary_image_url || r.image_url || null,
        resultMessage: r.scrape_status === 'failed'
          ? (r.scrape_error?.slice(0, 200) || 'Scrape failed')
          : undefined,
      }));
      setScrapeItems(items);
    };
    pull();
    const t = window.setInterval(pull, 5000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, []);

  // ── Admin VEO/Seedance pipeline (product_creative). Realtime channel ──
  // Admins are the only users with permission to read this table; the query
  // simply returns nothing for everyone else, so no extra guard needed here.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const pull = async () => {
      const since = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
      const { data } = await supabase!
        .from('product_creative')
        .select('id, status, style, model, created_at, updated_at, completed_at, error, product:products(name, brand, primary_image_url, image_url)')
        .or(`status.in.(queued,pending,generating),and(status.in.(done,failed),updated_at.gte.${since})`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (cancelled) return;
      type Row = {
        id: string; status: string; style: string | null; model: string | null;
        created_at: string; updated_at: string | null; completed_at: string | null; error: string | null;
        product: { name: string | null; brand: string | null; primary_image_url: string | null; image_url: string | null } | null;
      };
      const items: QueueItem[] = ((data as Row[] | null) || []).map(r => {
        const running = r.status === 'queued' || r.status === 'pending' || r.status === 'generating';
        return {
          id: `creative-${r.id}`,
          source: 'creative',
          label: r.product?.name || 'Creative',
          context: [r.product?.brand, (r.style || '').replace(/_/g, ' ')].filter(Boolean).join(' · ') || undefined,
          model: r.model || undefined,
          status: running ? 'running' : r.status === 'done' ? 'done' : 'failed',
          startedAt: new Date(r.created_at).getTime(),
          endedAt: r.completed_at ? new Date(r.completed_at).getTime() : (r.updated_at ? new Date(r.updated_at).getTime() : undefined),
          estimatedMs: CREATIVE_EST_MS,
          thumbnailUrl: r.product?.primary_image_url || r.product?.image_url || null,
          resultMessage: r.status === 'failed' ? (r.error?.slice(0, 200) || 'Generation failed') : undefined,
        };
      });
      setCreativeItems(items);
    };
    pull();
    const channel = supabase
      .channel('queue-host-creative')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_creative' }, pull)
      .subscribe();
    return () => { cancelled = true; if (channel) void supabase!.removeChannel(channel); };
  }, []);

  // Merge every source into ONE queue. De-dup local gen-jobs against the
  // external (DB-mirrored) stream by id, like the previous host did.
  const items = useMemo<QueueItem[]>(() => {
    const localIds = new Set(localJobs.map(j => j.id));
    const merged: QueueItem[] = [
      ...localJobs.map(genJobToItem),
      ...externalJobs.filter(j => !localIds.has(j.id)).map(genJobToItem),
      ...scrapeItems,
      ...creativeItems,
    ];
    return merged;
  }, [localJobs, externalJobs, scrapeItems, creativeItems]);

  const active  = useMemo(() => items.filter(i => i.status === 'running'), [items]);
  const history = useMemo(() => items.filter(i => i.status === 'done')   .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)), [items]);
  const failed  = useMemo(() => items.filter(i => i.status === 'failed') .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)), [items]);

  // Tick once a second while anything is running so the bars animate.
  useEffect(() => {
    if (active.length === 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [active.length]);

  // Click-outside closes the panel (keep the circle visible).
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setPanelOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [panelOpen]);

  const visible = tab === 'active' ? active : tab === 'history' ? history : failed;

  return (
    <div className="gen-queue-host" role="status" aria-live="polite">
      <button
        type="button"
        className={`gen-queue-fab${active.length > 0 ? ' is-active' : ''}${panelOpen ? ' is-open' : ''}`}
        aria-label={`Generation queue · ${active.length} running`}
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen(o => !o)}
      >
        {/* Catalog spark + tiny orbit dots — same identity as the home hero. */}
        <svg viewBox="0 0 140 140" width="22" height="22" aria-hidden="true">
          <g className="gen-queue-fab-orbit">
            <rect x="65"  y="6"   width="10" height="10" rx="2" fill="currentColor" opacity="0.55" />
            <rect x="124" y="65"  width="10" height="10" rx="2" fill="currentColor" opacity="0.55" />
            <rect x="65"  y="124" width="10" height="10" rx="2" fill="currentColor" opacity="0.55" />
            <rect x="6"   y="65"  width="10" height="10" rx="2" fill="currentColor" opacity="0.55" />
          </g>
          <path transform="translate(20 20)"
            d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z"
            fill="currentColor" />
        </svg>
        {active.length > 0 && (
          <span className="gen-queue-badge">{active.length}</span>
        )}
      </button>

      {panelOpen && (
        <div ref={panelRef} className="gen-queue-panel">
          <div className="gen-queue-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'active'}
              className={`gen-queue-tab${tab === 'active' ? ' is-on' : ''}`}
              onClick={() => setTab('active')}>
              Active <span className="gen-queue-tab-count">{active.length}</span>
            </button>
            <button role="tab" aria-selected={tab === 'history'}
              className={`gen-queue-tab${tab === 'history' ? ' is-on' : ''}`}
              onClick={() => setTab('history')}>
              History <span className="gen-queue-tab-count">{history.length}</span>
            </button>
            <button role="tab" aria-selected={tab === 'failed'}
              className={`gen-queue-tab${tab === 'failed' ? ' is-on' : ''}`}
              onClick={() => setTab('failed')}>
              Failed <span className="gen-queue-tab-count">{failed.length}</span>
            </button>
          </div>

          <div className="gen-queue-list">
            {visible.length === 0 ? (
              <div className="gen-queue-empty">
                {tab === 'active'  && 'Nothing in flight.'}
                {tab === 'history' && 'No recent completions.'}
                {tab === 'failed'  && 'No failures in the last hour.'}
              </div>
            ) : (
              visible.map(i => <QueueRow key={i.id} item={i} now={now} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QueueRow({ item, now }: { item: QueueItem; now: number }) {
  const elapsed = (item.endedAt ?? now) - item.startedAt;
  const ratio = item.status === 'running'
    ? Math.min(0.96, elapsed / Math.max(1, item.estimatedMs))
    : 1;
  const pct = Math.round(ratio * 100);
  const overEstimate = item.status === 'running' && elapsed > item.estimatedMs;
  const remaining = item.status === 'running'
    ? formatRemaining(Math.max(0, item.estimatedMs - elapsed), overEstimate)
    : (item.status === 'done' ? 'Done' : 'Failed');
  const kindLabel = item.source === 'gen' ? '' : item.source === 'scrape' ? 'Scrape' : 'Creative';
  return (
    <div className={`gen-queue-row gen-queue-row--${item.status}`}>
      {item.thumbnailUrl && (
        <img className="gen-queue-thumb" src={item.thumbnailUrl} alt="" />
      )}
      <div className="gen-queue-row-body">
        <div className="gen-queue-row-head">
          <span className="gen-queue-label">{item.label}</span>
          <span className="gen-queue-remaining">{remaining}</span>
        </div>
        {(item.context || item.model || kindLabel) && (
          <div className="gen-queue-context">
            {kindLabel && <span className="gen-queue-kind">{kindLabel}</span>}
            {item.context && <span className="gen-queue-context-text">{item.context}</span>}
            {item.model && <span className="gen-queue-model" title="Model">{item.model}</span>}
          </div>
        )}
        <div className="gen-queue-bar" aria-hidden>
          <div className={`gen-queue-bar-fill${overEstimate ? ' is-over' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        {item.resultMessage && (
          <div className={`gen-queue-result${item.status === 'failed' ? ' is-err' : ''}`}>{item.resultMessage}</div>
        )}
      </div>
    </div>
  );
}

function formatRemaining(ms: number, overEstimate: boolean): string {
  if (overEstimate) return 'Finalising…';
  if (ms < 1000) return '<1s';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs === 0 ? `${m}m left` : `${m}m ${rs}s left`;
}

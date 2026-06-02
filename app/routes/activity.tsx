/* /activity — dedicated activity surface for signed-in users.
 *
 * Separate from the wallet. Two halves:
 *
 *   ① Creator side — if the viewer has looks, show their lifetime
 *      engagement (impressions / clicks / clickouts) + per-look
 *      performance table. Data: existing creator_engagement_summary
 *      RPC + a client-side aggregate of user_events targeting their
 *      looks (RLS user_events_target_owner_select).
 *
 *   ② Shopper side — show the viewer's own behavior: what product
 *      TYPES they click on most, what BRANDS they like. Data: user's
 *      own user_events (RLS user_events_owner_select) joined to
 *      products client-side for the type/brand fields.
 *
 * Realtime ticker at the top hooks the same `catalog:activity-bump`
 * event that HeaderActivityPill listens to, so the ticker updates
 * without a second realtime channel.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useAuth } from '~/hooks/useAuth';
import { getEngagementSummary, type EngagementSummary } from '~/services/creator-engagement';
import {
  getMyTopLooks,
  getMyShopperSelf,
  getMyRecentEvents,
  type ActivityLookStat,
  type ActivityTypeStat,
  type ActivityBrandStat,
  type ActivityRecentEvent,
} from '~/services/activity';
import CountUp from '~/components/CountUp';
import SiteParticleHost from '~/components/SiteParticleHost';
import '~/styles/activity-page.css';

export default function ActivityRoute() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  // Auth gate: bounce to the landing if no user. We do this in an effect
  // so the redirect happens once auth resolves rather than during render.
  useEffect(() => {
    if (!authLoading && !user?.id) navigate('/', { replace: true });
  }, [authLoading, user?.id, navigate]);

  // ── State ──────────────────────────────────────────────────────────
  const [engagement, setEngagement] = useState<EngagementSummary | null>(null);
  const [topLooks, setTopLooks] = useState<ActivityLookStat[] | null>(null);
  const [shopperSelf, setShopperSelf] = useState<{
    topTypes: ActivityTypeStat[];
    topBrands: ActivityBrandStat[];
    totalClickouts: number;
  } | null>(null);
  const [recent, setRecent] = useState<ActivityRecentEvent[] | null>(null);

  // Mark the activity pill as "seen" when this route opens — same
  // localStorage key the pill reads on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem('catalog:activity-unseen:v1', '0'); } catch { /* quota */ }
  }, []);

  // Initial fetch fanout. Each call is independent — we render whatever
  // resolves so a slow shopper-self query doesn't block the creator hero.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getEngagementSummary().then(v => { if (!cancelled) setEngagement(v); });
    getMyTopLooks(10).then(v => { if (!cancelled) setTopLooks(v); });
    getMyShopperSelf({ typeLimit: 6, brandLimit: 6 }).then(v => { if (!cancelled) setShopperSelf(v); });
    getMyRecentEvents(12).then(v => { if (!cancelled) setRecent(v); });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Realtime: on every catalog:activity-bump (dispatched by
  // ActivityRealtimeToasts whenever a new event arrives), refresh the
  // recent stream + engagement summary so the ticker stays live.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user?.id) return;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [e, r] = await Promise.all([getEngagementSummary(), getMyRecentEvents(12)]);
        setEngagement(e);
        setRecent(r);
      } finally { pending = false; }
    };
    window.addEventListener('catalog:activity-bump', refresh as EventListener);
    return () => window.removeEventListener('catalog:activity-bump', refresh as EventListener);
  }, [user?.id]);

  // Derived: CTR and clickout rate for the creator panel. Null when no
  // baseline yet so we render a friendlier "—" rather than NaN%.
  const ctr = useMemo(() => {
    if (!engagement || engagement.total_impressions === 0) return null;
    return engagement.total_clicks / engagement.total_impressions;
  }, [engagement]);
  const clickoutRate = useMemo(() => {
    if (!engagement || engagement.total_clicks === 0) return null;
    return engagement.total_clickouts / engagement.total_clicks;
  }, [engagement]);

  const isCreator = (topLooks && topLooks.length > 0) || (engagement && engagement.total_impressions > 0);

  return (
    <div className="ap-root">
      {/* Shared singleton particle field — same one the landing uses,
          mounted at the page root so this surface feels like part of the
          same product, not a system page. */}
      <SiteParticleHost />

      <header className="ap-header">
        <button type="button" className="ap-back" onClick={() => navigate(-1)} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="ap-title">Activity</h1>
      </header>

      <main className="ap-content">
        {/* ── Live ticker ─────────────────────────────────────────── */}
        <RecentTicker events={recent} />

        {/* ── Creator hero: engagement summary ────────────────────── */}
        {isCreator !== false && (
          <section className="ap-section">
            <div className="ap-section-head">
              <h2 className="ap-section-title">Your reach</h2>
              <span className="ap-section-sub">All time · last 7 days in green</span>
            </div>
            <div className="ap-stat-grid">
              <StatTile label="Impressions"
                value={engagement?.total_impressions ?? 0}
                weekly={engagement?.week_impressions ?? 0}
                ready={engagement !== null} />
              <StatTile label="Clicks"
                value={engagement?.total_clicks ?? 0}
                weekly={engagement?.week_clicks ?? 0}
                ready={engagement !== null} />
              <StatTile label="Clickouts"
                value={engagement?.total_clickouts ?? 0}
                weekly={engagement?.week_clickouts ?? 0}
                ready={engagement !== null} />
              <StatTile label="CTR"
                value={ctr === null ? null : Math.round(ctr * 1000) / 10}
                suffix="%"
                weekly={null}
                ready={engagement !== null} />
            </div>
            {clickoutRate !== null && (
              <div className="ap-stat-footnote">
                {Math.round(clickoutRate * 100)}% of clicks become clickouts to a retailer.
              </div>
            )}
          </section>
        )}

        {/* ── Per-look performance ────────────────────────────────── */}
        {topLooks && topLooks.length > 0 && (
          <section className="ap-section">
            <div className="ap-section-head">
              <h2 className="ap-section-title">Top looks</h2>
              <span className="ap-section-sub">Ranked by impressions</span>
            </div>
            <div className="ap-look-list">
              {topLooks.map((l, i) => (
                <div key={l.look_id} className="ap-look-row">
                  <span className="ap-look-rank">{i + 1}</span>
                  {l.thumbnail_url
                    ? <img className="ap-look-thumb" src={l.thumbnail_url} alt="" />
                    : <div className="ap-look-thumb ap-look-thumb--empty" />}
                  <div className="ap-look-body">
                    <div className="ap-look-title">{l.title || 'Untitled look'}</div>
                    <div className="ap-look-metrics">
                      <span><CountUp value={l.impressions} /> impressions</span>
                      <span>·</span>
                      <span><CountUp value={l.clicks} /> clicks</span>
                      <span>·</span>
                      <span><CountUp value={l.clickouts} /> clickouts</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Shopper-self: what you click on most ────────────────── */}
        {shopperSelf && shopperSelf.totalClickouts > 0 && shopperSelf.topTypes.length > 0 && (
          <section className="ap-section">
            <div className="ap-section-head">
              <h2 className="ap-section-title">What you shop for</h2>
              <span className="ap-section-sub">Based on {shopperSelf.totalClickouts} of your clicks</span>
            </div>
            <div className="ap-chip-row">
              {shopperSelf.topTypes.map(t => (
                <span key={t.type} className="ap-chip">
                  <span className="ap-chip-label">{t.type}</span>
                  <span className="ap-chip-count">{t.count}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Your top brands ──────────────────────────────────────── */}
        {shopperSelf && shopperSelf.topBrands.length > 0 && (
          <section className="ap-section">
            <div className="ap-section-head">
              <h2 className="ap-section-title">Your top brands</h2>
              <span className="ap-section-sub">The labels you keep coming back to</span>
            </div>
            <div className="ap-brand-grid">
              {shopperSelf.topBrands.map(b => (
                <div key={b.brand} className="ap-brand-tile">
                  {b.thumbnail_url
                    ? <img className="ap-brand-thumb" src={b.thumbnail_url} alt="" />
                    : <div className="ap-brand-thumb ap-brand-thumb--empty" />}
                  <div className="ap-brand-body">
                    <div className="ap-brand-name">{b.brand}</div>
                    <div className="ap-brand-count">{b.count} clicks</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Empty / first-time state ───────────────────────────── */}
        {engagement && engagement.total_impressions === 0 &&
         (!shopperSelf || shopperSelf.totalClickouts === 0) && (
          <section className="ap-section ap-empty">
            <div className="ap-empty-mark" aria-hidden>✨</div>
            <h2 className="ap-empty-title">Nothing to show yet</h2>
            <p className="ap-empty-body">
              Once people start viewing your looks — or once you start clicking on
              things in the feed — this is where you'll see how it's going.
            </p>
          </section>
        )}

        {/* ── Skeletons ───────────────────────────────────────────── */}
        {engagement === null && topLooks === null && shopperSelf === null && (
          <section className="ap-section">
            <div className="ap-stat-grid">
              {[0, 1, 2, 3].map(i => <div key={i} className="ap-skel ap-skel-tile" />)}
            </div>
            <div className="ap-skel ap-skel-row" />
            <div className="ap-skel ap-skel-row" />
          </section>
        )}
      </main>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────

function StatTile({
  label, value, suffix = '', weekly, ready,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  weekly: number | null;
  ready: boolean;
}) {
  return (
    <div className="ap-stat-tile">
      <div className="ap-stat-label">{label}</div>
      <div className="ap-stat-value">
        {!ready
          ? <span className="ap-stat-skel" />
          : value === null
            ? <span className="ap-stat-empty">—</span>
            : <><CountUp value={value} duration={1100} /><span className="ap-stat-suffix">{suffix}</span></>}
      </div>
      {weekly !== null && weekly > 0 && (
        <div className="ap-stat-weekly">
          +<CountUp value={weekly} duration={900} /> this week
        </div>
      )}
    </div>
  );
}

function RecentTicker({ events }: { events: ActivityRecentEvent[] | null }) {
  if (!events || events.length === 0) return null;
  return (
    <div className="ap-ticker" role="status" aria-live="polite">
      <div className="ap-ticker-track">
        {events.map(e => (
          <span key={e.id} className={`ap-ticker-pill ap-ticker-pill--${e.event_type}`}>
            <span className="ap-ticker-dot" />
            <span className="ap-ticker-label">
              {e.event_type === 'impression' ? 'Saw' : e.event_type === 'click' ? 'Tapped' : 'Clicked out'}
              {' '}
              <strong>{e.title || 'your look'}</strong>
            </span>
            <span className="ap-ticker-time">{formatRelative(e.created_at)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const dt = Date.parse(iso);
  if (!dt) return '';
  const s = Math.max(0, Math.round((Date.now() - dt) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

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

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useNavigate } from '@remix-run/react';
import { withTransform } from '~/utils/supabase-image';
import { useAuth } from '~/hooks/useAuth';
import { getEngagementSummary, type EngagementSummary } from '~/services/creator-engagement';
import {
  getMyTopLooks,
  getMyShopperSelf,
  getMyRecentEvents,
  getMyCommentActivity,
  resolveCommentMedia,
  type ActivityLookStat,
  type ActivityTypeStat,
  type ActivityBrandStat,
  type ActivityRecentEvent,
  type CommentActivityItem,
  type CommentMedia,
} from '~/services/activity';
import type { CommentTargetType } from '~/services/comments';
import { listUserGenerations, isGenerationInFlight, getLookUuidForGeneration, type UserGeneration } from '~/services/user-generations';
import CountUp from '~/components/CountUp';
import SiteParticleHost from '~/components/SiteParticleHost';
import ConsumerAvatar from '~/components/ConsumerAvatar';
import '~/styles/activity-page.css';

// Comment thread opens as an in-app overlay (kept on this route) rather than
// navigating to /comments/… — that deep-link cold-boots the SPA into the
// splash screen. Lazy so the heavy particle/comment chunk loads on demand.
const CommentsPage = lazy(() => import('~/components/CommentsPage'));

/**
 * Top-look thumbnail: paints a tiny (~160px, q60) poster first so it lands
 * fast (well under ~15KB), then — once the poster is on screen and a video
 * exists — mounts the muted clip behind it and crossfades to it on canplay.
 */
function TopLookThumb({ thumbnailUrl, videoUrl }: { thumbnailUrl: string | null; videoUrl: string | null }) {
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const poster = thumbnailUrl ? (withTransform(thumbnailUrl, { width: 160, quality: 60, format: 'webp' }) ?? null) : null;
  const mountVideo = !!videoUrl && posterLoaded;

  useEffect(() => {
    if (!mountVideo) return;
    const v = videoRef.current;
    if (!v) return;
    const onCanPlay = () => setVideoReady(true);
    v.addEventListener('canplay', onCanPlay, { once: true });
    return () => v.removeEventListener('canplay', onCanPlay);
  }, [mountVideo]);

  if (!poster && !videoUrl) return <div className="ap-look-thumb ap-look-thumb--empty" />;

  return (
    <div className="ap-look-thumb">
      {poster && (
        <img
          className="ap-look-thumb-media"
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setPosterLoaded(true)}
          onError={() => setPosterLoaded(true)}
          style={{ opacity: videoReady ? 0 : 1 }}
        />
      )}
      {mountVideo && (
        <video
          ref={videoRef}
          className="ap-look-thumb-media ap-look-thumb-video"
          src={videoUrl || undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          style={{ opacity: videoReady ? 1 : 0 }}
        />
      )}
    </div>
  );
}

/**
 * Conversation-card thumbnail. Resolves the comment's target (product or
 * look slug) to a poster + primary video, paints the still first, then
 * crossfades to the muted clip on canplay — same pattern as TopLookThumb,
 * sized for the conversation row. Renders inline elements only so it's
 * valid inside the row <button>.
 */
function ConvThumb({ targetType, targetId }: { targetType: CommentTargetType; targetId: string }) {
  const [media, setMedia] = useState<CommentMedia | null>(null);
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveCommentMedia(targetType, targetId).then(m => { if (!cancelled) setMedia(m); });
    return () => { cancelled = true; };
  }, [targetType, targetId]);

  const poster = media?.image ? (withTransform(media.image, { width: 120, quality: 60, format: 'webp' }) ?? null) : null;
  const videoUrl = media?.video || null;
  const mountVideo = !!videoUrl && posterLoaded;

  useEffect(() => {
    if (!mountVideo) return;
    const v = videoRef.current;
    if (!v) return;
    const onCanPlay = () => setVideoReady(true);
    v.addEventListener('canplay', onCanPlay, { once: true });
    return () => v.removeEventListener('canplay', onCanPlay);
  }, [mountVideo]);

  if (!poster && !videoUrl) return <span className="ap-conv-thumb ap-conv-thumb--empty" aria-hidden />;

  return (
    <span className="ap-conv-thumb" aria-hidden>
      {poster && (
        <img
          className="ap-conv-thumb-media"
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setPosterLoaded(true)}
          onError={() => setPosterLoaded(true)}
          style={{ opacity: videoReady ? 0 : 1 }}
        />
      )}
      {mountVideo && (
        <video
          ref={videoRef}
          className="ap-conv-thumb-media ap-conv-thumb-video"
          src={videoUrl || undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          style={{ opacity: videoReady ? 1 : 0 }}
        />
      )}
    </span>
  );
}

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
  const [commentActivity, setCommentActivity] = useState<CommentActivityItem[] | null>(null);
  // Conversation thread overlay: index into commentActivity (or null), plus a
  // minimized flag so the user can dock it and keep browsing the activity page.
  const [convIdx, setConvIdx] = useState<number | null>(null);
  const [convMinimized, setConvMinimized] = useState(false);
  // The shopper's own recently-created looks (generations). Drives the
  // "Your looks" rail at the top — in-flight rows show a rendering bar.
  const [myGenerations, setMyGenerations] = useState<UserGeneration[] | null>(null);

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
    getMyCommentActivity(30).then(v => { if (!cancelled) setCommentActivity(v); });
    listUserGenerations(user.id).then(v => { if (!cancelled) setMyGenerations(v); });
    return () => { cancelled = true; };
  }, [user?.id]);

  // While any generation is mid-render, poll so the rendering bar clears
  // and the finished look pops in without a manual refresh. Stops polling
  // once nothing is in flight.
  useEffect(() => {
    if (!user?.id) return;
    const anyInFlight = (myGenerations ?? []).some(isGenerationInFlight);
    if (!anyInFlight) return;
    const t = window.setInterval(() => {
      listUserGenerations(user.id).then(setMyGenerations).catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [user?.id, myGenerations]);

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
        const [e, r, c] = await Promise.all([getEngagementSummary(), getMyRecentEvents(12), getMyCommentActivity(30)]);
        setEngagement(e);
        setRecent(r);
        setCommentActivity(c);
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
        {/* ── 🔥 milestone banner — a comment of yours hit 5 fires ──── */}
        {commentActivity?.some(c => c.kind === 'fire' && c.milestone) && (
          <div className="ap-milestone" role="status">
            <span className="ap-milestone-emoji" aria-hidden>🔥</span>
            <span className="ap-milestone-text">
              {commentActivity.filter(c => c.kind === 'fire' && c.milestone).length === 1
                ? 'One of your comments hit 5 fires!'
                : `${commentActivity.filter(c => c.kind === 'fire' && c.milestone).length} of your comments hit 5 fires!`}
            </span>
          </div>
        )}

        {/* ── Your reach — engagement summary, pinned to the top ────── */}
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

        {/* ── Your looks — recent generations + rendering progress ──── */}
        <YourLooksRail generations={myGenerations} />

        {/* ── Who saw your looks — collapsible, starts collapsed ────── */}
        <RecentLedger events={recent} />

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
                  <TopLookThumb thumbnailUrl={l.thumbnail_url} videoUrl={l.video_url} />
                  <div className="ap-look-body">
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

        {/* ── Conversations: your comments, replies, fires received ── */}
        {commentActivity && commentActivity.length > 0 && (
          <section className="ap-section">
            <div className="ap-section-head">
              <h2 className="ap-section-title">Conversations</h2>
              <span className="ap-section-sub">Your comments, replies &amp; 🔥</span>
            </div>
            <div className="ap-conv-list">
              {commentActivity.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  className={`ap-conv-row ap-conv-row--${c.kind}`}
                  onClick={() => { setConvIdx(i); setConvMinimized(false); }}
                >
                  <span className="ap-conv-thumb-wrap">
                    <ConvThumb targetType={c.target_type} targetId={c.target_id} />
                    <span className="ap-conv-kind" aria-hidden>
                      {c.kind === 'fire' ? '🔥' : c.kind === 'reply' ? '💬' : '✏️'}
                    </span>
                  </span>
                  <span className="ap-conv-body">
                    <span className="ap-conv-head">
                      {c.kind === 'mine' && 'You commented'}
                      {c.kind === 'reply' && <>{c.actor_name || 'Someone'} replied</>}
                      {c.kind === 'fire' && <>Your comment got {c.fire_count} 🔥{c.milestone ? ' — milestone!' : ''}</>}
                      {c.target_label && <span className="ap-conv-on"> · {c.target_label}</span>}
                    </span>
                    <span className="ap-conv-text">{c.body}</span>
                  </span>
                  <span className="ap-conv-time">{formatRelative(c.created_at)}</span>
                </button>
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
         (!shopperSelf || shopperSelf.totalClickouts === 0) &&
         (!commentActivity || commentActivity.length === 0) && (
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

      {/* Conversation thread overlay — opens in place (no splash), pages
          through the Conversations list, and minimizes to a dock bar. */}
      {convIdx != null && commentActivity && commentActivity[convIdx] && !convMinimized && (
        <Suspense fallback={null}>
          <CommentsPage
            key={`${commentActivity[convIdx].target_type}:${commentActivity[convIdx].target_id}`}
            targetType={commentActivity[convIdx].target_type}
            slug={commentActivity[convIdx].target_id}
            onClose={() => { setConvIdx(null); setConvMinimized(false); }}
            onMinimize={() => setConvMinimized(true)}
            onPrev={() => setConvIdx(i => (i != null ? Math.max(0, i - 1) : i))}
            onNext={() => setConvIdx(i => (i != null ? Math.min(commentActivity.length - 1, i + 1) : i))}
            hasPrev={convIdx > 0}
            hasNext={convIdx < commentActivity.length - 1}
            onOpenCreator={(h) => { setConvIdx(null); setConvMinimized(false); window.location.assign(`/c/${h}`); }}
          />
        </Suspense>
      )}

      {/* Minimized dock — tap to re-expand the thread, ✕ to dismiss. */}
      {convIdx != null && convMinimized && commentActivity?.[convIdx] && (
        <div className="ap-conv-dock" role="button" tabIndex={0}
          onClick={() => setConvMinimized(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setConvMinimized(false); }}
        >
          <span className="ap-conv-dock-icon" aria-hidden>💬</span>
          <span className="ap-conv-dock-text">
            <span className="ap-conv-dock-label">{commentActivity[convIdx].target_label || 'Conversation'}</span>
            <span className="ap-conv-dock-hint">Tap to expand</span>
          </span>
          <button
            type="button"
            className="ap-conv-dock-close"
            aria-label="Close conversation"
            onClick={(e) => { e.stopPropagation(); setConvIdx(null); setConvMinimized(false); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}
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

// "Your looks" rail — the shopper's most recent generations. In-flight
// rows render a left-to-right progress sweep + "Rendering"; finished rows
// autoplay the clip; failed rows read as such.
function YourLooksRail({ generations }: { generations: UserGeneration[] | null }) {
  if (!generations || generations.length === 0) return null;
  const recent = generations.slice(0, 10);
  const renderingCount = recent.filter(isGenerationInFlight).length;
  return (
    <section className="ap-section">
      <div className="ap-section-head">
        <h2 className="ap-section-title">Your looks</h2>
        <span className="ap-section-sub">
          {renderingCount > 0 ? `${renderingCount} rendering now` : 'Recently created'}
        </span>
      </div>
      <div className="ap-gens-rail">
        {recent.map(g => <GenTile key={g.id} gen={g} />)}
      </div>
    </section>
  );
}

function GenTile({ gen }: { gen: UserGeneration }) {
  const navigate = useNavigate();
  const inFlight = isGenerationInFlight(gen);
  const failed = gen.status === 'failed' || (!inFlight && gen.status !== 'done');
  const label = gen.display_name || gen.style || 'New look';

  // Tapping a finished render opens its look screen. The completed
  // generation auto-landed as a look (source_generation_id); resolve that
  // uuid and deep-link the home feed to open the look overlay. Falls back
  // to My Catalog if the look row isn't there yet.
  const openLook = useCallback(async () => {
    const uuid = await getLookUuidForGeneration(gen.id);
    if (uuid) navigate(`/?look=${uuid}`);
    else window.dispatchEvent(new CustomEvent('catalog:open-my-catalog'));
  }, [gen.id, navigate]);
  if (inFlight) {
    return (
      <button
        type="button"
        className="ap-gen ap-gen--rendering"
        title={`${label} — rendering`}
        onClick={() => navigate(`/generate?gen=${gen.id}`)}
        aria-label={`${label} — rendering, open progress`}
      >
        <div className="ap-gen-shimmer" />
        <div className="ap-gen-foot">
          <span className="ap-gen-name">{label}</span>
          <span className="ap-gen-status">Rendering…</span>
          <span className="ap-gen-bar"><span className="ap-gen-bar-fill" /></span>
        </div>
      </button>
    );
  }
  if (failed) {
    return (
      <div className="ap-gen ap-gen--failed" title={`${label} — failed`}>
        <div className="ap-gen-foot">
          <span className="ap-gen-name">{label}</span>
          <span className="ap-gen-status">Failed</span>
        </div>
      </div>
    );
  }
  return (
    <button type="button" className="ap-gen ap-gen--done" title={label} onClick={openLook} aria-label={`Open ${label}`}>
      {gen.video_url
        ? <video className="ap-gen-media" src={gen.video_url} muted loop autoPlay playsInline preload="metadata" />
        : <div className="ap-gen-media ap-gen-media--blank" />}
      <div className="ap-gen-foot">
        <span className="ap-gen-name">{label}</span>
      </div>
    </button>
  );
}

// Named ledger of who recently interacted with your looks. Replaces the
// old anonymous "Saw your look" ticker — each row names the viewer (from
// their profile) with their avatar, the verb, and which look.
function RecentLedger({ events }: { events: ActivityRecentEvent[] | null }) {
  // Collapsible, and starts collapsed — this list can get long, so it sits
  // tucked away under a tappable header until the creator opens it.
  const [open, setOpen] = useState(false);
  if (!events || events.length === 0) return null;
  const verb = (t: ActivityRecentEvent['event_type']) =>
    t === 'impression' ? 'saw' : t === 'click' ? 'tapped' : 'clicked out on';
  return (
    <section className="ap-section">
      <button
        type="button"
        className="ap-section-head ap-section-head--toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="ap-section-head-text">
          <h2 className="ap-section-title">Who saw your looks</h2>
          <span className="ap-section-sub">Most recent activity · {events.length}</span>
        </span>
        <svg className={`ap-section-chevron ${open ? 'is-open' : ''}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
      <div className="ap-ledger">
        {events.map(e => (
          <div key={e.id} className={`ap-ledger-row ap-ledger-row--${e.event_type}`}>
            <ConsumerAvatar name={e.actor_name || 'Someone'} url={e.actor_avatar} size={36} className="ap-ledger-avatar" />
            <span className="ap-ledger-label">
              <strong>{e.actor_name || 'Someone'}</strong>
              {' '}{verb(e.event_type)}{' '}
              <span className="ap-ledger-look">{e.title || 'your look'}</span>
            </span>
            <span className="ap-ledger-time">{formatRelative(e.created_at)}</span>
          </div>
        ))}
      </div>
      )}
    </section>
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

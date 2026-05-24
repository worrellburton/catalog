import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from '@remix-run/react';
import { looks, creators, type Look } from '~/data/looks';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { supabase } from '~/utils/supabase';
import { uploadUserPhoto, type UserUpload, type UserGeneration } from '~/services/user-generations';
import type { StyleGeneration, StyleGenerationImage } from '~/services/style-generations';
import {
  getUserAnalytics,
  clickThroughRate,
  formatDurationMs,
  type UserAnalyticsRow,
} from '~/services/analytics';
import type { UserGender } from '~/services/genders';
import AdminProfileEditor from '~/components/AdminProfileEditor';
import { AvatarUpload } from '~/components/AvatarCropModal';
import CountUp from '~/components/CountUp';

interface StyleGenWithImages extends StyleGeneration {
  images: StyleGenerationImage[];
}

function findCreatorHandle(displayName: string): string | null {
  for (const [handle, c] of Object.entries(creators)) {
    if (c.displayName.toLowerCase() === displayName.toLowerCase()) return handle;
  }
  return null;
}

function LookRow({ look, expanded, onToggle }: { look: Look; expanded: boolean; onToggle: () => void }) {
  const creator = creators[look.creator];
  return (
    <>
      <tr className="admin-clickable-row" onClick={onToggle}>
        <td className="admin-cell-name">
          <video
            src={`${import.meta.env.BASE_URL}${look.video}`}
            className="admin-look-thumb"
            muted
            playsInline
            preload="metadata"
          />
          <span>{look.title}</span>
        </td>
        <td>{creator?.displayName || look.creator}</td>
        <td><span className={`admin-gender-badge admin-gender-${look.gender}`}>{look.gender === 'men' ? 'Men' : 'Women'}</span></td>
        <td>{look.products.length}</td>
        <td className="admin-cell-muted">{look.description}</td>
        <td>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </td>
      </tr>
      {expanded && (
        <tr className="admin-look-products-row">
          <td colSpan={6}>
            <div className="admin-products-grid">
              {look.products.map((p, i) => (
                <div key={i} className="admin-product-card">
                  {p.image && <img src={p.image} alt={p.name} className="admin-product-img" />}
                  <div className="admin-product-info">
                    <span className="admin-product-name">{p.name}</span>
                    <span className="admin-product-brand">{p.brand}</span>
                    <span className="admin-product-price">{p.price}</span>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface LookTableRow {
  id: number;
  title: string;
  creatorName: string;
  gender: string;
  productCount: number;
  description: string;
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  role: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  gender: string | null;
  height_cm: number | null;
  height_label: string | null;
  weight_kg: number | null;
  weight_label: string | null;
  age_label: string | null;
  is_ai: boolean | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminUserDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const decoded = decodeURIComponent(name || '');

  // Try the URL slug as a user-id first (the new routing scheme), then
  // fall back to creator-handle resolution from seed data so legacy
  // creator links keep working.
  const creatorHandle = findCreatorHandle(decoded);
  const creator = creatorHandle ? creators[creatorHandle] : null;

  const creatorLooks = useMemo(() => {
    if (!creatorHandle) return [];
    return looks.filter(l => l.creator === creatorHandle);
  }, [creatorHandle]);

  const tableRows: LookTableRow[] = useMemo(() =>
    creatorLooks.map(l => ({
      id: l.id,
      title: l.title,
      creatorName: creator?.displayName || l.creator,
      gender: l.gender,
      productCount: l.products.length,
      description: l.description,
    })),
  [creatorLooks, creator]);

  const lookTable = useSortableTable(tableRows);
  const [expandedLook, setExpandedLook] = useState<number | null>(null);

  // Resolve the URL slug to a profile row + their uploads + their
  // generations. Routing now keys off the auth-user UUID directly, so
  // collisions on display name (we have multiple "Robert Burton"s)
  // don't silently drop user data. We still accept legacy
  // name/email links via the fallback path.
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [uploads, setUploads] = useState<UserUpload[]>([]);
  const [generations, setGenerations] = useState<UserGeneration[]>([]);
  const [styleGens, setStyleGens] = useState<StyleGenWithImages[]>([]);
  const [analytics, setAnalytics] = useState<UserAnalyticsRow | null>(null);
  const [resolved, setResolved] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  // Tab state for the Generated looks section. 'all' shows every row
  // (default behaviour); 'queue' filters to pending/generating; 'done'
  // filters to successful renders; 'failed' filters to the error path.
  // Mounted as local state so a refresh resets to All — the value isn't
  // worth syncing to the URL or persisting.
  const [genTab, setGenTab] = useState<'all' | 'queue' | 'done' | 'failed'>('all');
  useEffect(() => {
    if (!supabase) { setResolved(true); return; }
    let cancelled = false;
    setResolved(false);
    setProfile(null);
    (async () => {
      let prof: ProfileRow | null = null;

      // 1) UUID slug - direct id lookup, no ambiguity.
      if (UUID_RE.test(decoded)) {
        const { data } = await supabase
          .from('profiles')
          .select('id, email, full_name, avatar_url, provider, role, created_at, last_sign_in_at, gender, height_cm, height_label, weight_kg, weight_label, age_label, is_ai')
          .eq('id', decoded)
          .maybeSingle();
        prof = (data ?? null) as ProfileRow | null;
      }

      // 2) Legacy: full_name lookup. We pull all matches and pick the
      //    one with the most data so a name collision doesn't show a
      //    blank profile (the old behavior).
      if (!prof) {
        const { data } = await supabase
          .from('profiles')
          .select('id, email, full_name, avatar_url, provider, role, created_at, last_sign_in_at, gender, height_cm, height_label, weight_kg, weight_label, age_label, is_ai')
          .ilike('full_name', decoded);
        const candidates = (data ?? []) as ProfileRow[];
        if (candidates.length === 1) {
          prof = candidates[0];
        } else if (candidates.length > 1) {
          const counts = await Promise.all(candidates.map(async (c) => {
            const [{ count: u }, { count: g }] = await Promise.all([
              supabase!.from('user_uploads').select('*', { count: 'exact', head: true }).eq('user_id', c.id),
              supabase!.from('user_generations').select('*', { count: 'exact', head: true }).eq('user_id', c.id),
            ]);
            return { row: c, score: (u ?? 0) + (g ?? 0) };
          }));
          counts.sort((a, b) => b.score - a.score);
          prof = counts[0].row;
        }
      }

      // 3) Legacy: email-local-part fallback for shoppers without a
      //    full_name set on their profile.
      if (!prof) {
        const { data } = await supabase
          .from('profiles')
          .select('id, email, full_name, avatar_url, provider, role, created_at, last_sign_in_at, gender, height_cm, height_label, weight_kg, weight_label, age_label, is_ai')
          .ilike('email', `${decoded}@%`)
          .limit(1)
          .maybeSingle();
        prof = (data ?? null) as ProfileRow | null;
      }

      if (cancelled) return;
      setProfile(prof);

      if (!prof) { setResolved(true); return; }
      const [{ data: u }, { data: g }, { data: s }] = await Promise.all([
        supabase!.from('user_uploads').select('*').eq('user_id', prof.id).order('created_at', { ascending: false }),
        supabase!.from('user_generations').select('*').eq('user_id', prof.id).order('created_at', { ascending: false }),
        supabase!.from('style_generations').select('*').eq('user_id', prof.id).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setUploads((u || []) as UserUpload[]);
      setGenerations((g || []) as UserGeneration[]);
      const styleParents = (s || []) as StyleGeneration[];
      // Hydrate the 4 image rows for each parent in one IN-list query so
      // the section renders the actual style sheets, not just metadata.
      if (styleParents.length > 0) {
        const { data: imgs } = await supabase!
          .from('style_generation_images')
          .select('*')
          .in('generation_id', styleParents.map(p => p.id))
          .order('sort_order');
        const byParent = new Map<string, StyleGenerationImage[]>();
        ((imgs || []) as StyleGenerationImage[]).forEach(img => {
          const list = byParent.get(img.generation_id) ?? [];
          list.push(img);
          byParent.set(img.generation_id, list);
        });
        setStyleGens(styleParents.map(p => ({ ...p, images: byParent.get(p.id) ?? [] })));
      } else {
        setStyleGens([]);
      }
      setResolved(true);
    })();
    return () => { cancelled = true; };
  }, [decoded]);

  // Pull the user's analytics row from the realtime RPC + subscribe
  // to user_sessions / user_events writes so the Activity card on
  // this page updates the moment a session heartbeats or an event
  // lands. We re-run the (small) RPC instead of computing deltas
  // because the rollup is cheap and the result is a single row.
  useEffect(() => {
    if (!profile?.id) { setAnalytics(null); return; }
    const targetId = profile.id;
    let cancelled = false;
    let timer: number | null = null;
    const refetch = () => {
      getUserAnalytics().then(rows => {
        if (cancelled) return;
        setAnalytics(rows.find(r => r.user_id === targetId) ?? null);
      });
    };
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(refetch, 400);
    };
    refetch();
    if (!supabase) return () => { cancelled = true; };
    const channel = supabase
      .channel(`user-detail-analytics:${targetId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_sessions', filter: `user_id=eq.${targetId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_events',   filter: `user_id=eq.${targetId}` }, schedule)
      .subscribe();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  // Poll in-flight generations every 3s so the Generation queue card
  // (and the Generated looks grid) promote pending → done|failed in
  // place without an admin-side page refresh. Mirrors the consumer
  // /generate page's list-polling pattern.
  useEffect(() => {
    if (!supabase || !profile?.id) return;
    const targetId = profile.id;
    const inFlight = generations.some(g => g.status === 'pending' || g.status === 'generating');
    if (!inFlight) return;
    const handle = window.setInterval(async () => {
      const { data } = await supabase!
        .from('user_generations')
        .select('*')
        .eq('user_id', targetId)
        .order('created_at', { ascending: false });
      if (!data) return;
      setGenerations(data as UserGeneration[]);
    }, 3000);
    return () => window.clearInterval(handle);
  }, [profile?.id, generations]);

  // Resolve display names for every admin that has triggered a
  // generation on this user, so the queue row can render
  // "Triggered by <admin name>" instead of a bare UUID. One read on
  // mount + whenever the set of admin ids referenced changes.
  const [adminLabels, setAdminLabels] = useState<Record<string, string>>({});
  const adminIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const g of generations) {
      if (g.triggered_by_admin_id) ids.add(g.triggered_by_admin_id);
    }
    return Array.from(ids).sort().join(',');
  }, [generations]);
  useEffect(() => {
    if (!supabase || !adminIdsKey) { setAdminLabels({}); return; }
    const ids = adminIdsKey.split(',').filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const next: Record<string, string> = {};
        for (const row of data as { id: string; full_name: string | null; email: string | null }[]) {
          next[row.id] = row.full_name || row.email?.split('@')[0] || row.id.slice(0, 8);
        }
        setAdminLabels(next);
      });
    return () => { cancelled = true; };
  }, [adminIdsKey]);

  // Header info - prefer real profile data over the URL slug. Fall
  // back to the slug + creator data for legacy creator links.
  const displayName = profile?.full_name || creator?.displayName || decoded;
  const avatarUrl = profile?.avatar_url || creator?.avatar || null;
  const isCreator = !!creator && !profile;  // creator-only when we couldn't resolve a profile

  const totalProducts = creatorLooks.reduce((sum, l) => sum + l.products.length, 0);
  const uniqueBrands = new Set(creatorLooks.flatMap(l => l.products.map(p => p.brand)));

  return (
    <div className="admin-page aud-page">
      <div className="aud-hero">
        <button className="aud-back" onClick={() => navigate('/admin/users')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back to Users
        </button>
        <div className="aud-identity">
          <div className={`aud-avatar-ring ${profile?.is_ai ? 'is-ai' : 'is-human'}`}>
            {profile?.id ? (
              <AvatarUpload
                userId={profile.id}
                currentUrl={avatarUrl ?? undefined}
                fallbackInitial={(displayName || '?').charAt(0)}
                onUploaded={(url) => setProfile(p => p ? { ...p, avatar_url: url } : p)}
              />
            ) : avatarUrl ? (
              <img src={avatarUrl} alt="" className="aud-avatar-img" />
            ) : (
              <span className="aud-avatar-fallback">
                {(displayName || '?').charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="aud-identity-text">
            <div className="aud-chip-row">
              <span className={`ape-kind-chip ${profile?.is_ai ? 'is-ai' : 'is-human'}`}>
                {profile?.is_ai ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2l1.7 4.3L18 8l-4.3 1.7L12 14l-1.7-4.3L6 8l4.3-1.7L12 2zm6 12l1 2.5L21.5 17 19 18l-1 2.5L17 18l-2.5-1L17 16l1-2z"/>
                    </svg>
                    AI persona
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="8" r="4"/>
                      <path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
                    </svg>
                    Human
                  </>
                )}
              </span>
              <span className="aud-status-dot" aria-label="Active">
                <span className="aud-status-pulse" />
              </span>
              <span className="aud-status-text">Active</span>
            </div>
            <h1 className="aud-name">{displayName}</h1>
            <p className="aud-subtitle">
              {profile?.is_ai
                ? 'Synthetic persona — generated looks attach to this profile.'
                : isCreator ? 'Creator profile and looks.' : 'Shopper profile and activity.'}
            </p>
          </div>
        </div>
      </div>

      <div className="admin-detail-grid">
        <div className="admin-detail-card aud-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Profile</h3>
            {profile?.id && (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setEditingProfile(true)}
                style={{ padding: '4px 10px', fontSize: 12 }}
                title="Edit name, gender, height, and age"
              >
                Edit
              </button>
            )}
          </div>
          <div className="admin-detail-rows" style={{ marginTop: 10 }}>
            <div className="admin-detail-row"><span>Name</span><span>{displayName}</span></div>
            {profile?.email && <div className="admin-detail-row"><span>Email</span><span>{profile.email}</span></div>}
            {profile?.provider && <div className="admin-detail-row"><span>SSO</span><span style={{ textTransform: 'capitalize' }}>{profile.provider}</span></div>}
            {creatorHandle && <div className="admin-detail-row"><span>Handle</span><span>{creatorHandle}</span></div>}
            <div className="admin-detail-row"><span>Status</span><span className="admin-status-active">Active</span></div>
            <div className="admin-detail-row"><span>Type</span><span style={{ textTransform: 'capitalize' }}>{profile?.role || (isCreator ? 'Creator' : 'Shopper')}</span></div>
            {profile?.gender && (
              <div className="admin-detail-row"><span>Gender</span><span style={{ textTransform: 'capitalize' }}>{profile.gender}</span></div>
            )}
            {(profile?.height_label || profile?.height_cm) && (
              <div className="admin-detail-row">
                <span>Height</span>
                <span>
                  {profile.height_label || `${profile.height_cm} cm`}
                  {profile.height_label && profile.height_cm ? ` (${profile.height_cm} cm)` : ''}
                </span>
              </div>
            )}
            {(profile?.weight_label || profile?.weight_kg) && (
              <div className="admin-detail-row">
                <span>Weight</span>
                <span>
                  {profile.weight_label || `${profile.weight_kg} kg`}
                  {profile.weight_label && profile.weight_kg ? ` (${profile.weight_kg} kg)` : ''}
                </span>
              </div>
            )}
            {profile?.age_label && (
              <div className="admin-detail-row"><span>Age</span><span>{profile.age_label}</span></div>
            )}
            {profile?.created_at && (
              <div className="admin-detail-row"><span>Joined</span><span>{new Date(profile.created_at).toLocaleDateString()}</span></div>
            )}
            {profile?.id && <div className="admin-detail-row"><span>User ID</span><span style={{ fontFamily: 'monospace', fontSize: 11 }}>{profile.id.slice(0, 8)}…</span></div>}
          </div>
        </div>
        <div className="admin-detail-card aud-card">
          <h3>Activity</h3>
          <div className="admin-detail-rows">
            <div className="admin-detail-row"><span>Looks</span><CountUp value={creatorLooks.length + generations.length} /></div>
            <div className="admin-detail-row"><span>Products</span><CountUp value={totalProducts} /></div>
            <div className="admin-detail-row"><span>Brands</span><CountUp value={uniqueBrands.size} /></div>
            <div className="admin-detail-row"><span>Reference photos</span><CountUp value={uploads.length} /></div>
            <div className="admin-detail-row"><span>Saved</span><CountUp value={0} /></div>
          </div>
        </div>
        {/* Engagement card mirrors the per-row data in /admin/analytics
            so the user detail page is a 1:1 view into the same telemetry.
            Realtime: a session heartbeat or new event re-renders these
            rows the moment they hit the DB. */}
        <div className="admin-detail-card aud-card">
          <div className="aud-card-head">
            <h3>Engagement</h3>
            <span className="aud-private" title="Visible to admins only. Users don't see their own engagement telemetry.">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Admin only
            </span>
          </div>
          <div className="admin-detail-rows">
            <div className="admin-detail-row">
              <span>Last sign-in</span>
              <span>{analytics?.last_sign_in_at
                ? new Date(analytics.last_sign_in_at).toLocaleString()
                : (profile?.last_sign_in_at
                    ? new Date(profile.last_sign_in_at).toLocaleString()
                    : '—')}</span>
            </div>
            <div className="admin-detail-row"><span>Sign-ins</span><CountUp value={analytics?.sign_in_count ?? 0} /></div>
            <div className="admin-detail-row"><span>Impressions</span><CountUp value={analytics?.total_impressions ?? 0} /></div>
            <div className="admin-detail-row"><span>Clicks</span><CountUp value={analytics?.total_clicks ?? 0} /></div>
            <div className="admin-detail-row"><span>Clickouts</span><CountUp value={analytics?.total_clickouts ?? 0} /></div>
            <div className="admin-detail-row">
              <span>CTR</span>
              <span>{(() => {
                const ctr = analytics ? clickThroughRate(analytics) : null;
                return ctr === null ? '—' : `${(ctr * 100).toFixed(1)}%`;
              })()}</span>
            </div>
            <div className="admin-detail-row"><span>Avg session</span><span>{formatDurationMs(analytics?.avg_session_ms ?? 0)}</span></div>
            <div className="admin-detail-row"><span>Total session</span><span>{formatDurationMs(analytics?.total_session_ms ?? 0)}</span></div>
            <div className="admin-detail-row"><span>Idle</span><span>{formatDurationMs(analytics?.total_idle_ms ?? 0)}</span></div>
          </div>
        </div>
      </div>

      {isCreator && creatorLooks.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 className="admin-section-title">Looks ({creatorLooks.length})</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <SortableTh label="Look" sortKey="title" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <SortableTh label="Creator" sortKey="creatorName" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <SortableTh label="Gender" sortKey="gender" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <SortableTh label="Products" sortKey="productCount" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <SortableTh label="Description" sortKey="description" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {lookTable.sortedData.map(row => {
                  const look = creatorLooks.find(l => l.id === row.id)!;
                  return (
                    <LookRow
                      key={row.id}
                      look={look}
                      expanded={expandedLook === row.id}
                      onToggle={() => setExpandedLook(prev => prev === row.id ? null : row.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isCreator && (
        <div className="admin-detail-grid" style={{ marginTop: 16 }}>
          <div className="admin-detail-card aud-card">
            <h3>Recent Searches</h3>
            <div className="aud-empty">
              <svg className="aud-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <span>No searches yet</span>
            </div>
          </div>
          <div className="admin-detail-card aud-card">
            <h3>Recent Clicks</h3>
            <div className="aud-empty">
              <svg className="aud-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 11l3 3 8-8"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              <span>No clicks yet</span>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <PhotoUploader
          userId={profile?.id ?? null}
          uploadCount={uploads.length}
          onUploaded={u => setUploads(prev => [u, ...prev])}
        />
        {!resolved ? (
          <div className="aud-skeleton-grid" aria-busy="true" aria-label="Loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aud-skeleton aud-skeleton-tile" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        ) : uploads.length === 0 ? (
          <p className="admin-detail-empty">No reference photos uploaded yet</p>
        ) : (
          <div className="aud-photo-grid">
            {uploads.map((u, i) => (
              <a
                key={u.id}
                href={u.public_url}
                target="_blank"
                rel="noopener noreferrer"
                className="aud-photo-tile"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <img src={u.public_url} alt="" loading="lazy" />
                <span className="aud-photo-tile-overlay">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6M14 10l7-7M9 21H3v-6M10 14l-7 7"/>
                  </svg>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="admin-section-title" style={{ margin: 0 }}>
            Generated looks ({generations.length})
          </h2>
          {profile?.is_ai && profile?.id && (
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={() => navigate(`/generate?as_user=${profile.id}`)}
              title="Open the Generate wizard with this AI persona as the active user — every upload, slot pick, and resulting look attaches to the persona."
            >
              Generate look as this persona
            </button>
          )}
        </div>
        {/* Tabs split the rows by status so the Queue (live, polling
            every 3s) reads at a glance vs the static history below.
            Counts update in place as rows promote. */}
        {generations.length > 0 && (() => {
          const queueCount = generations.filter(g => g.status === 'pending' || g.status === 'generating').length;
          const doneCount = generations.filter(g => g.status === 'done').length;
          const failedCount = generations.filter(g => g.status === 'failed').length;
          const tabs: { key: typeof genTab; label: string; count: number }[] = [
            { key: 'all',    label: 'All',         count: generations.length },
            { key: 'queue',  label: 'In queue',    count: queueCount },
            { key: 'done',   label: 'Completed',   count: doneCount },
            { key: 'failed', label: 'Failed',      count: failedCount },
          ];
          return (
            <div className="aud-tabs" role="tablist">
              {tabs.map(t => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={genTab === t.key}
                  onClick={() => setGenTab(t.key)}
                  className={`aud-tab ${genTab === t.key ? 'is-active' : ''}`}
                >
                  <span className="aud-tab-label">{t.label}</span>
                  <span className="aud-tab-count">{t.count}</span>
                </button>
              ))}
            </div>
          );
        })()}
        {(() => {
          if (!resolved) return <div className="aud-skeleton-grid" aria-busy="true" aria-label="Loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aud-skeleton aud-skeleton-tile" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>;
          if (generations.length === 0) return <p className="admin-detail-empty">No looks generated yet</p>;
          const filtered = generations.filter(g => {
            if (genTab === 'all') return true;
            if (genTab === 'queue') return g.status === 'pending' || g.status === 'generating';
            return g.status === genTab;
          });
          if (filtered.length === 0) {
            return <p className="admin-detail-empty">No looks in this tab</p>;
          }
          return (
            <div className="aud-look-grid">
              {filtered.map((g, i) => {
                const triggeredByAdmin = !!g.triggered_by_admin_id
                  && g.triggered_by_admin_id !== profile?.id;
                const adminName = g.triggered_by_admin_id
                  ? (adminLabels[g.triggered_by_admin_id] || g.triggered_by_admin_id.slice(0, 8))
                  : null;
                return (
                  <div
                    key={g.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/admin/publish/${g.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/admin/publish/${g.id}`);
                      }
                    }}
                    className="aud-look-tile"
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                    title="Open look detail to publish, review, or retry"
                  >
                    <div className="aud-look-tile-media">
                      {g.video_url ? (
                        <video src={g.video_url} muted loop playsInline autoPlay />
                      ) : (
                        <div className={`aud-look-tile-empty ${g.status === 'failed' ? 'is-failed' : ''}`}>
                          <div className="aud-look-tile-status">
                            {g.status === 'failed' ? 'Failed' : 'Processing…'}
                          </div>
                          {g.status === 'failed' && g.error && (
                            <div className="aud-look-tile-error" title={g.error}>{g.error}</div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="aud-look-tile-meta">
                      <div className="aud-look-tile-title">{g.style} · {g.height_label || ' - '}</div>
                      <div className="aud-look-tile-sub">{g.status} · {new Date(g.created_at).toLocaleDateString()}</div>
                    </div>
                    <div className="aud-look-tile-attribution">
                      <span className={`aud-trigger-chip ${triggeredByAdmin ? 'is-admin' : 'is-self'}`}>
                        {triggeredByAdmin ? (
                          <>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="8" r="4"/>
                              <path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
                            </svg>
                            Admin · {adminName}
                          </>
                        ) : (
                          <>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <path d="M12 2l1.7 4.3L18 8l-4.3 1.7L12 14l-1.7-4.3L6 8l4.3-1.7L12 2z"/>
                            </svg>
                            Self
                          </>
                        )}
                      </span>
                    </div>
                    {g.status === 'failed' && g.error && (
                      <div
                        title={g.error}
                        style={{
                          marginTop: 6, color: '#b91c1c', fontSize: 11, lineHeight: 1.35,
                          background: '#fef2f2', border: '1px solid #fecaca',
                          borderRadius: 4, padding: '6px 8px',
                          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                          overflow: 'hidden', wordBreak: 'break-word',
                        }}
                      >
                        {g.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 className="admin-section-title">Generated styles ({styleGens.length})</h2>
        {!resolved ? (
          <div className="aud-skeleton-grid" aria-busy="true" aria-label="Loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aud-skeleton aud-skeleton-tile" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        ) : styleGens.length === 0 ? (
          <p className="admin-detail-empty">No style sheets generated yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {styleGens.map(s => (
              <div key={s.id} style={{
                borderRadius: 8, background: '#fff', border: '1px solid #eee',
                padding: 12, fontSize: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ color: '#1a1a1a', fontWeight: 600, fontSize: 13 }}>
                      {s.occasion || '—'}
                    </div>
                    <div style={{ color: '#666', marginTop: 2 }}>
                      {s.status} · {new Date(s.created_at).toLocaleDateString()}
                      {s.height_label && ` · ${s.height_label}`}
                      {s.age_label && ` · ${s.age_label}`}
                      {s.gender && s.gender !== 'unknown' && ` · ${s.gender}`}
                    </div>
                  </div>
                  {s.error && (
                    <span style={{ color: '#b91c1c', fontSize: 11 }}>{s.error}</span>
                  )}
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 8,
                  marginTop: 10,
                }}>
                  {Array.from({ length: 4 }, (_, i) => {
                    const img = s.images.find(im => im.sort_order === i);
                    return (
                      <div key={i} style={{
                        aspectRatio: '1 / 1',
                        borderRadius: 6,
                        overflow: 'hidden',
                        background: '#f3f3f3',
                        position: 'relative',
                      }}>
                        {img?.image_url ? (
                          <a href={img.image_url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={img.image_url}
                              alt={`${s.occasion} ${i + 1}`}
                              loading="lazy"
                              decoding="async"
                              width={1280}
                              height={720}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            />
                          </a>
                        ) : (
                          <div style={{
                            width: '100%', height: '100%', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, color: '#888', textAlign: 'center', padding: 6,
                          }}>
                            {img?.status === 'failed' ? (img.error?.slice(0, 60) || 'Failed') : '…'}
                          </div>
                        )}
                        {img && (
                          <span style={{
                            position: 'absolute', bottom: 4, left: 4,
                            padding: '2px 6px', borderRadius: 999,
                            background: 'rgba(0,0,0,0.7)', color: '#fff',
                            fontSize: 9, fontWeight: 600, letterSpacing: 0.02,
                          }}>{img.provider}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingProfile && profile?.id && (
        <AdminProfileEditor
          userId={profile.id}
          initial={{
            fullName: profile.full_name,
            heightCm: profile.height_cm,
            heightLabel: profile.height_label,
            weightKg: profile.weight_kg,
            weightLabel: profile.weight_label,
            ageLabel: profile.age_label,
            gender: (profile.gender === 'male' || profile.gender === 'female')
              ? (profile.gender as UserGender)
              : 'unknown',
            isAi: !!profile.is_ai,
            email: profile.email ?? null,
          }}
          onClose={() => setEditingProfile(false)}
          onSaved={(next) => {
            setProfile(prev => prev ? {
              ...prev,
              full_name: next.fullName,
              height_cm: next.heightCm,
              height_label: next.heightLabel,
              weight_kg: next.weightKg,
              weight_label: next.weightLabel,
              age_label: next.ageLabel,
              gender: next.gender,
            } : prev);
            setEditingProfile(false);
          }}
        />
      )}
    </div>
  );
}


interface PhotoUploaderProps {
  userId: string | null;
  uploadCount: number;
  onUploaded: (u: UserUpload) => void;
}

/**
 * Admin-side reference-photo uploader. Sits inline with the
 * "Reference photos (N)" section header so admins can fill in
 * reference shots for any user — most useful for AI personas
 * that don't upload themselves, but available on every detail
 * page since the existing scraper / generator pipeline can
 * consume reference photos from real users too.
 */
function PhotoUploader({ userId, uploadCount, onUploaded }: PhotoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!userId) return;
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file later
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    for (const file of files) {
      const { data, error: uploadErr } = await uploadUserPhoto(file, userId);
      if (uploadErr || !data) {
        setError(uploadErr || "Upload failed");
        break;
      }
      onUploaded(data);
    }
    setUploading(false);
  }, [userId, onUploaded]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
      <h2 className="admin-section-title" style={{ margin: 0 }}>
        Reference photos ({uploadCount})
      </h2>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {error && <span style={{ fontSize: 12, color: "#dc2626" }}>{error}</span>}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onChange}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          disabled={!userId || uploading}
          onClick={pickFiles}
          title={userId ? "Upload reference photos for this user" : "User has no DB profile to attach photos to"}
        >
          {uploading ? "Uploading…" : "+ Upload photos"}
        </button>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useSearchParams } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { getProfiles, updateUserRole, updateUserIsAdmin, deleteProfile, type Profile } from '~/services/profiles';
import { supabase } from '~/utils/supabase';
import { auditAllUserGenders, type UserGender } from '~/services/genders';
import { getWaitlistIds } from '~/services/waitlist';
import { creators as lookCreators, looks } from '~/data/looks';
import type { UserRole } from '~/types/roles';
import { USER_ROLE_LABELS } from '~/types/roles';
import AdminWaitlistPanel from '~/components/AdminWaitlistPanel';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

// "Last online" reads better at a glance as a relative duration than
// an absolute timestamp. Falls back to absolute date once the gap is
// older than a week so the column never shows "37 days ago" - that's
// less useful than the actual date.
function formatRelative(iso: string | null): string {
  if (!iso) return '-';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

interface UserRow {
  id: string;
  initials: string;
  name: string;
  email: string;
  avatar: string;
  sso: string;
  role: UserRole;
  isAdmin: boolean;
  gender: UserGender;
  createdAt: string;
  lastSignIn: string;
  looksCount: number;
  location: string;
  saved: number;
  followings: number;
  creator: string;
}

// Count looks per creator handle
const looksPerCreator: Record<string, number> = {};
for (const look of looks) {
  looksPerCreator[look.creator] = (looksPerCreator[look.creator] || 0) + 1;
}

function profileToRow(p: Profile): UserRow {
  const name = p.full_name || p.email?.split('@')[0] || 'Unknown';
  return {
    id: p.id,
    initials: name.slice(0, 2).toUpperCase(),
    name,
    email: p.email || '',
    avatar: p.avatar_url || `https://i.pravatar.cc/40?u=${p.id}`,
    sso: p.provider === 'google' ? 'Google' : p.provider === 'phone' ? 'Phone' : 'SSO',
    role: p.role || 'shopper',
    isAdmin: p.is_admin === true,
    gender: ((p as { gender?: string }).gender as UserGender) || 'unknown',
    createdAt: formatDate(p.created_at),
    lastSignIn: formatRelative(p.last_sign_in_at),
    looksCount: 0,
    location: '-',
    saved: 0,
    followings: 0,
    creator: '-',
  };
}

type Tab = 'waitlist' | 'users' | 'admins' | 'super-admins';

const TAB_VALUES: readonly Tab[] = ['waitlist', 'users', 'admins', 'super-admins'];

function isTab(value: string | null): value is Tab {
  return value !== null && (TAB_VALUES as readonly string[]).includes(value);
}

type ToastType = 'success' | 'info' | 'warning';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string; iconColor: string }> = {
  success: { bg: '#10b981', border: '#059669', icon: '\u2713', iconColor: '#ffffff' },
  info: { bg: '#3b82f6', border: '#2563eb', icon: '\u2139', iconColor: '#ffffff' },
  warning: { bg: '#f59e0b', border: '#d97706', icon: '\u26A0', iconColor: '#ffffff' },
};

const TOAST_ANIMATIONS = `
@keyframes admin-toast-slide-up {
  from { transform: translateY(120%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes admin-toast-slide-down {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(120%); opacity: 0; }
}
.admin-toast-enter { animation: admin-toast-slide-up 260ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.admin-toast-exit { animation: admin-toast-slide-down 240ms cubic-bezier(0.4, 0, 1, 1) both; }
`;

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <>
      <style>{TOAST_ANIMATIONS}</style>
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          zIndex: 10000,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => {
          const s = TOAST_STYLES[t.type];
          return (
            <div
              key={t.id}
              className={t.exiting ? 'admin-toast-exit' : 'admin-toast-enter'}
              style={{
                width: 320,
                background: s.bg,
                color: '#ffffff',
                borderRadius: 8,
                boxShadow: '0 10px 25px rgba(0,0,0,0.25), 0 4px 10px rgba(0,0,0,0.15)',
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                pointerEvents: 'auto',
                border: `1px solid ${s.border}`,
                fontSize: 14,
                lineHeight: 1.4,
              }}
              role="status"
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  color: s.iconColor,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {s.icon}
              </span>
              <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.message}</span>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss notification"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.9)',
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                  padding: 0,
                  marginLeft: 4,
                  flexShrink: 0,
                }}
              >
                {'\u00d7'}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function RoleBadge({ role, userId, onRoleChange }: { role: UserRole; userId: string; onRoleChange: (id: string, role: UserRole, error?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      // Don't close if clicking inside the dropdown portal
      const dropdown = document.querySelector('.admin-role-dropdown');
      if (dropdown && dropdown.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Use setTimeout so the current click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick); };
  }, [open]);

  const handleChange = async (newRole: UserRole) => {
    if (newRole === role) { setOpen(false); return; }
    setUpdating(true);
    const { error } = await updateUserRole(userId, newRole);
    setUpdating(false);
    setOpen(false);
    if (error) {
      console.error('Role update failed:', error);
      onRoleChange(userId, newRole, error);
      return;
    }
    onRoleChange(userId, newRole);
  };

  return (
    <div className="admin-role-badge-wrap">
      <button
        ref={btnRef}
        className={`admin-role-badge admin-role-${role}`}
        onClick={handleOpen}
        disabled={updating}
      >
        {updating ? '...' : USER_ROLE_LABELS[role]}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && pos && ReactDOM.createPortal(
        <div
          className="admin-role-dropdown"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(Object.keys(USER_ROLE_LABELS) as UserRole[]).map(r => (
            <button
              key={r}
              className={`admin-role-option ${r === role ? 'active' : ''}`}
              onClick={() => handleChange(r)}
            >
              {USER_ROLE_LABELS[r]}
              {r === role && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// Pass 2: module-scope cache. The admin re-enters /admin/users many
// times per session (deep links from creator/shopper detail pages,
// tab nav, etc.). Caching the last-seen rows here means the page
// paints with data on the next visit instead of flashing empty
// tables while the network round-trips. Realtime + focus refetch
// keep it honest.
let cachedUsers: UserRow[] | null = null;
let cachedWaitlistIds: Set<string> | null = null;

// Seed-data creators come from app/data/looks.ts so the row can't be
// removed from the bundle, but the admin still needs delete semantics.
// We persist a localStorage set of "deleted" handles and filter them
// out of the Creators tab - same end-state as a real delete from the
// admin's POV (gone, doesn't return on refresh).
const DELETED_CONTENT_CREATORS_KEY = 'catalog:admin-deleted-content-creators';

function readDeletedContentCreators(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DELETED_CONTENT_CREATORS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
    // Migrate the legacy "hidden" key once so admins don't lose deletes.
    const legacy = window.localStorage.getItem('catalog:admin-hidden-content-creators');
    if (legacy) {
      const parsed = JSON.parse(legacy) as string[];
      window.localStorage.setItem(DELETED_CONTENT_CREATORS_KEY, JSON.stringify(parsed));
      window.localStorage.removeItem('catalog:admin-hidden-content-creators');
      return new Set(parsed);
    }
  } catch { /* parse / quota */ }
  return new Set();
}

function writeDeletedContentCreators(set: Set<string>) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(DELETED_CONTENT_CREATORS_KEY, JSON.stringify([...set])); } catch { /* quota */ }
}

export default function AdminUsers() {
  // Each tab has its own URL — `?tab=waitlist|users|admins|super-admins`.
  // Default is `users` when no param is present (or it's invalid). We
  // bind through useSearchParams so deep-links land on the right tab,
  // the back button walks tab history, and the "Move to admin" CTA's
  // tab switch updates the URL too.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const activeTab: Tab = isTab(tabFromUrl) ? tabFromUrl : 'users';
  const setActiveTab = useCallback((next: Tab) => {
    setSearchParams(prev => {
      const out = new URLSearchParams(prev);
      if (next === 'users') out.delete('tab');
      else                  out.set('tab', next);
      return out;
    }, { replace: false });
  }, [setSearchParams]);
  // Pass 2: seed from module cache so re-entering the page paints
  // with data immediately. Realtime + initial fetch refresh in place.
  const [allUsers, setAllUsers] = useState<UserRow[]>(() => cachedUsers ?? []);
  const [waitlistIds, setWaitlistIds] = useState<Set<string>>(() => cachedWaitlistIds ?? new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loaded, setLoaded] = useState<boolean>(() => cachedUsers !== null);
  const [auditingGender, setAuditingGender] = useState(false);
  const [deletedContentCreators, setDeletedContentCreators] = useState<Set<string>>(() => readDeletedContentCreators());
  const toastIdRef = useRef(0);
  const lastToastRef = useRef<{ message: string; ts: number } | null>(null);
  const navigate = useNavigate();

  // Pass 1: declare toast helpers BEFORE any useEffect that closes
  // over them. Previously the realtime subscription effect listed
  // `showToast` in its deps array but `showToast` was declared lower
  // in the function body — a TDZ violation that threw at render
  // time, which is what made the page feel broken. Order matters.
  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 240);
  }, []);

  const showToast = useCallback((message: string, type: ToastType) => {
    // Pass 5: dedupe identical messages fired within 500ms. Optimistic
    // local toasts and the realtime subscription can both fire for
    // the same change — we only want to show it once.
    const now = Date.now();
    const last = lastToastRef.current;
    if (last && last.message === message && now - last.ts < 500) return;
    lastToastRef.current = { message, ts: now };
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      dismissToast(id);
    }, 4000);
  }, [dismissToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fetch profiles + per-user generated-look counts + waitlist
      // ids in parallel. Waitlist ids let us exclude users still
      // pending approval from the Shoppers tab - once you're on the
      // waitlist you're not a shopper.
      const [profiles, genRowsRes, ids] = await Promise.all([
        getProfiles(),
        supabase ? supabase.from('user_generations').select('user_id') : Promise.resolve({ data: null }),
        getWaitlistIds(),
      ]);
      if (cancelled) return;
      setWaitlistIds(ids);
      cachedWaitlistIds = ids;
      const counts = new Map<string, number>();
      const rows = ((genRowsRes as { data: { user_id: string }[] | null }).data) || [];
      for (const r of rows) counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1);
      const next = profiles.map(p => {
        const row = profileToRow(p);
        // Two sources contribute: (a) generated looks owned by the
        // auth user, (b) seed-data look authorship matched by name.
        const seedHandle = Object.values(lookCreators).find(
          c => c.displayName.toLowerCase() === row.name.toLowerCase(),
        )?.name;
        const seedCount = seedHandle ? (looksPerCreator[seedHandle] || 0) : 0;
        return { ...row, looksCount: (counts.get(p.id) || 0) + seedCount };
      });
      setAllUsers(next);
      cachedUsers = next;
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Pass 3: realtime — listen to the profiles table so any row that
  // another admin (or this admin in another tab) updates lands here
  // within ~50ms. Updates merge into allUsers; deletes drop the row;
  // inserts append. Each meaningful remote change drops a toast so
  // the admin sees who/what changed without having to reload. Pass 5
  // dedupe collapses the duplicate toast that fires when a local
  // optimistic change is echoed back over the realtime channel.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('admin-users-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const fresh = profileToRow(payload.new as Profile);
            setAllUsers(prev => {
              if (prev.some(u => u.id === fresh.id)) return prev;
              const next = [...prev, { ...fresh, looksCount: 0 }];
              cachedUsers = next;
              return next;
            });
            showToast(`${fresh.name} joined`, 'info');
            return;
          }
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id;
            if (!id) return;
            let removed: UserRow | undefined;
            setAllUsers(prev => {
              removed = prev.find(u => u.id === id);
              const next = prev.filter(u => u.id !== id);
              cachedUsers = next;
              return next;
            });
            if (removed) showToast(`${removed.name} was removed`, 'warning');
            return;
          }
          if (payload.eventType === 'UPDATE') {
            const fresh = profileToRow(payload.new as Profile);
            setAllUsers(prev => {
              const target = prev.find(u => u.id === fresh.id);
              if (!target) {
                const next = [...prev, { ...fresh, looksCount: 0 }];
                cachedUsers = next;
                return next;
              }
              // Only emit a remote-change toast when the fields we
              // surface actually changed; otherwise irrelevant churn
              // (last_sign_in_at ticking on session refresh, etc.)
              // would spam the admin. Pass 5 dedupe handles the case
              // where the optimistic toast already fired for the same
              // message text within the last 500ms.
              const fieldsChanged =
                target.role !== fresh.role
                || target.isAdmin !== fresh.isAdmin
                || target.gender !== fresh.gender
                || target.name !== fresh.name;
              if (fieldsChanged) {
                const what =
                  target.role !== fresh.role
                    ? `role changed to ${USER_ROLE_LABELS[fresh.role]}`
                    : target.isAdmin !== fresh.isAdmin
                      ? (fresh.isAdmin ? 'is now an admin' : 'is no longer an admin')
                      : 'updated';
                showToast(`${fresh.name} ${what}`, 'success');
              }
              const next = prev.map(u => u.id === fresh.id
                ? { ...u, ...fresh, looksCount: u.looksCount }
                : u);
              cachedUsers = next;
              return next;
            });
          }
        },
      )
      .subscribe();
    return () => {
      supabase!.removeChannel(channel);
    };
  }, [showToast]);

  // Pass 4 + 7: refetch on tab focus + soft 60s interval. Realtime
  // is the hot path; this is the safety net for missed events
  // (websocket drops, backgrounded tabs, etc.). The poll interval
  // dropped from 30s -> 60s since realtime + focus cover the common
  // cases and 30s was unnecessary network churn. Both refreshes are
  // best-effort: failures are silent.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const refresh = async () => {
      const profiles = await getProfiles();
      if (cancelled) return;
      setAllUsers(prev => {
        const byId = new Map(prev.map(u => [u.id, u]));
        const next = profiles.map(p => {
          const row = profileToRow(p);
          const prevRow = byId.get(p.id);
          return { ...row, looksCount: prevRow?.looksCount ?? 0 };
        });
        cachedUsers = next;
        return next;
      });
    };
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onFocus);
      window.clearInterval(interval);
    };
  }, []);

  // Pass 3: realtime — listen to the profiles table so any row that
  // another admin (or this admin in another tab) updates lands here
  // within ~50ms. Updates merge into allUsers; deletes drop the row;
  // inserts append. Each remote change drops a toast so the admin
  // sees who/what changed without having to reload.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('admin-users-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const fresh = profileToRow(payload.new as Profile);
            setAllUsers(prev => {
              if (prev.some(u => u.id === fresh.id)) return prev;
              return [...prev, { ...fresh, looksCount: 0 }];
            });
            return;
          }
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id;
            if (!id) return;
            let removed: UserRow | undefined;
            setAllUsers(prev => {
              removed = prev.find(u => u.id === id);
              return prev.filter(u => u.id !== id);
            });
            if (removed) showToast(`${removed.name} was removed`, 'warning');
            return;
          }
          if (payload.eventType === 'UPDATE') {
            const fresh = profileToRow(payload.new as Profile);
            setAllUsers(prev => {
              const target = prev.find(u => u.id === fresh.id);
              if (!target) return prev;
              // Only emit a remote-change toast when the fields we
              // surface actually changed; otherwise irrelevant churn
              // (last_sign_in_at ticking on session refresh, etc.)
              // would spam the admin.
              const fieldsChanged =
                target.role !== fresh.role
                || target.isAdmin !== fresh.isAdmin
                || target.gender !== fresh.gender
                || target.name !== fresh.name;
              if (fieldsChanged) {
                const what =
                  target.role !== fresh.role
                    ? `role -> ${USER_ROLE_LABELS[fresh.role]}`
                    : target.isAdmin !== fresh.isAdmin
                      ? (fresh.isAdmin ? 'made admin' : 'admin revoked')
                      : 'updated';
                showToast(`${fresh.name}: ${what}`, 'success');
              }
              return prev.map(u => u.id === fresh.id
                ? { ...u, ...fresh, looksCount: u.looksCount }
                : u);
            });
          }
        },
      )
      .subscribe();
    return () => {
      supabase!.removeChannel(channel);
    };
  }, [showToast]);

  // Pass 4: refetch on tab focus + soft 30s interval. The realtime
  // sub above is the hot path, but a periodic re-read catches missed
  // events (websocket drops, network blips, etc.) and the focus-
  // refetch covers tabs that were backgrounded across a change. Both
  // are best-effort: failures are silent.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const refresh = async () => {
      const profiles = await getProfiles();
      if (cancelled) return;
      setAllUsers(prev => {
        const byId = new Map(prev.map(u => [u.id, u]));
        return profiles.map(p => {
          const row = profileToRow(p);
          const prevRow = byId.get(p.id);
          return { ...row, looksCount: prevRow?.looksCount ?? 0 };
        });
      });
    };
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onFocus);
      window.clearInterval(interval);
    };
  }, []);

  const handleRoleChange = useCallback((userId: string, newRole: UserRole, error?: string) => {
    if (error) {
      showToast(`Failed to change role: ${error}`, 'warning');
      return;
    }
    setAllUsers(prev => {
      const target = prev.find(u => u.id === userId);
      if (target && target.role !== newRole) {
        const oldLabel = USER_ROLE_LABELS[target.role];
        const newLabel = USER_ROLE_LABELS[newRole];
        showToast(`${target.name}'s role changed from ${oldLabel} to ${newLabel}`, 'success');
      }
      const next = prev.map(u => {
        if (u.id !== userId) return u;
        // Role -> admin/super_admin should imply is_admin=true so the
        // user actually shows up under the Admins tab. Demoting away
        // from admin/super_admin doesn't auto-flip is_admin off — an
        // admin who happens to be primarily a "creator" is still an
        // admin and the explicit toggle is the source of truth in
        // that case.
        const elevated = newRole === 'admin' || newRole === 'super_admin';
        return { ...u, role: newRole, isAdmin: u.isAdmin || elevated };
      });
      cachedUsers = next;
      return next;
    });
    // Mirror the elevation to the DB so the next page load sees the
    // same state. Fire-and-forget; the optimistic UI is already
    // committed and a server failure surfaces as a toast.
    if (newRole === 'admin' || newRole === 'super_admin') {
      void updateUserIsAdmin(userId, true).then(({ error: err }) => {
        if (err) showToast(`Couldn’t mark admin flag: ${err}`, 'warning');
      });
    }
  }, [showToast]);

  // Pass 6: memoize the per-tab filters. allUsers is small today
  // (tens of rows) but recomputing four arrays + their sort tables
  // on every render — including every toast tick — was needless work
  // and made each toggle feel less crisp. Keys: allUsers, waitlistIds,
  // and deletedContentCreators (the only inputs that mutate the slices).
  //
  // Users tab combines shoppers + creators into one list. Anyone in
  // the waitlist OR currently elevated to admin/super_admin is filtered
  // out — admins live on their own tab and waitlisters live on theirs.
  // Seed-data creators from app/data/looks.ts are folded in too so
  // every person who shows up in the consumer feed has a row here.
  const dbUsers = useMemo(
    () => allUsers.filter(u =>
      (u.role === 'shopper' || u.role === 'creator')
      && !waitlistIds.has(u.id)
      && !u.isAdmin
    ),
    [allUsers, waitlistIds],
  );

  const contentCreators: UserRow[] = useMemo(() => {
    const dbNames = new Set(dbUsers.map(c => c.name.toLowerCase()));
    return Object.values(lookCreators)
      .filter(c => !dbNames.has(c.displayName.toLowerCase()))
      .filter(c => !deletedContentCreators.has(c.name))
      .map(c => ({
        id: `content-${c.name}`,
        initials: c.displayName.slice(0, 2).toUpperCase(),
        name: c.displayName,
        email: '',
        avatar: c.avatar,
        sso: '-',
        role: 'creator' as UserRole,
        isAdmin: false,
        gender: 'unknown' as UserGender,
        createdAt: '-',
        lastSignIn: '-',
        looksCount: looksPerCreator[c.name] || 0,
        location: '-',
        saved: 0,
        followings: 0,
        creator: '-',
      }));
  }, [dbUsers, deletedContentCreators]);

  const users = useMemo(() => [...dbUsers, ...contentCreators], [dbUsers, contentCreators]);
  // Admins tab: a user counts as an admin when EITHER the explicit
  // is_admin flag is true OR their primary role is admin / super_admin.
  // Either dimension alone used to be enough to make a user "vanish":
  // if you flipped role -> 'admin' via the role dropdown but is_admin
  // stayed false, the user dropped from Shoppers (role mismatch) and
  // never showed up here (is_admin false). We keep the union so no
  // matter how someone is promoted they appear here.
  const admins = useMemo(
    () => allUsers.filter(u => u.isAdmin || u.role === 'admin' || u.role === 'super_admin'),
    [allUsers],
  );
  // Super-admins are the strict tier (gates destructive UI on consumer
  // surfaces). Driven purely by role.
  const superAdmins = useMemo(
    () => allUsers.filter(u => u.role === 'super_admin'),
    [allUsers],
  );

  // Per-row delete. Real DB profiles → deleteProfile + cascade to
  // their generated_videos / user_generations. Seed-data ("content-*")
  // creators → mark the handle deleted in localStorage so the
  // Users tab filters them out, and add their bundled look ids to
  // admin_hidden_looks (or the local mirror) so the published feed
  // drops the looks too. The confirm copy reports the look count
  // we're about to take down with them.
  const handleDelete = useCallback(async (userId: string, fallbackName?: string) => {
    const target = allUsers.find(u => u.id === userId);

    if (target?.id.startsWith('content-') || (!target && userId.startsWith('content-'))) {
      const handle = userId.slice('content-'.length);
      const seed = lookCreators[handle];
      const label = target?.name || seed?.displayName || fallbackName || handle;
      const seedLooks = looks.filter(l => l.creator === handle);
      const lookCount = seedLooks.length;
      const lookLabel = lookCount === 1 ? '1 look' : `${lookCount} looks`;
      const message = lookCount > 0
        ? `This will permanently delete ${label} and ${lookLabel} they’ve published. This can’t be undone.`
        : `This will permanently delete ${label}. This can’t be undone.`;
      if (!confirm(`Delete ${label}?\n\n${message}`)) return;
      // Filter the creator out everywhere they show up.
      setDeletedContentCreators(prev => {
        const next = new Set(prev);
        next.add(handle);
        writeDeletedContentCreators(next);
        return next;
      });
      // And drop their looks from the consumer feed via the same
      // localStorage hidden-looks mirror useHiddenLooks reads on the
      // home grid. Best-effort upsert into admin_hidden_looks for
      // consistency when supabase is configured.
      if (seedLooks.length > 0) {
        try {
          const KEY = 'catalog:admin-hidden-looks';
          const raw = window.localStorage.getItem(KEY);
          const existing = new Set<number>(raw ? JSON.parse(raw) as number[] : []);
          for (const l of seedLooks) existing.add(l.id);
          window.localStorage.setItem(KEY, JSON.stringify([...existing]));
        } catch { /* quota */ }
        if (supabase) {
          await supabase
            .from('admin_hidden_looks')
            .upsert(seedLooks.map(l => ({ look_id: l.id })), { onConflict: 'look_id' })
            .then(({ error }) => { if (error) console.warn('[users] hide looks upsert failed:', error.message); });
        }
      }
      showToast(
        lookCount > 0 ? `${label} and ${lookLabel} deleted` : `${label} deleted`,
        'success',
      );
      return;
    }

    if (!target) return;
    const dbLookCount = looksPerCreator[target.name.toLowerCase()] || 0;
    const message = dbLookCount > 0
      ? `This will permanently delete ${target.name} and ${dbLookCount === 1 ? '1 look' : `${dbLookCount} looks`} they’ve published. This can’t be undone.`
      : `This will permanently delete ${target.name}. This can’t be undone.`;
    if (!confirm(`Delete ${target.name}?\n\n${message}`)) return;
    const { error } = await deleteProfile(userId);
    if (error) {
      showToast(`Failed to delete: ${error}`, 'warning');
      return;
    }
    // Best-effort cascade for the user's content. deleteProfile only
    // takes the profile row; their generations + admin-hide rows live
    // in adjacent tables and are dropped here so the feed doesn't
    // keep their content live after the account is gone.
    if (supabase) {
      await Promise.all([
        supabase.from('user_generations').delete().eq('user_id', userId),
        supabase.from('user_uploads').delete().eq('user_id', userId),
      ]).catch(err => console.warn('[users] cascade delete failed:', err));
    }
    setAllUsers(prev => {
      const next = prev.filter(u => u.id !== userId);
      cachedUsers = next;
      return next;
    });
    setWaitlistIds(prev => {
      if (!prev.has(userId)) return prev;
      const next = new Set(prev);
      next.delete(userId);
      cachedWaitlistIds = next;
      return next;
    });
    showToast(
      dbLookCount > 0
        ? `${target.name} and ${dbLookCount === 1 ? '1 look' : `${dbLookCount} looks`} deleted`
        : `${target.name} deleted`,
      'success',
    );
  }, [allUsers, showToast]);

  // Pass 5: in-flight guard. Map of (userId|field) -> in-flight Promise.
  // A second click on the same toggle while the first is mid-flight
  // is ignored; the DB write either lands or rolls back, then the
  // user can flip again. Stops rapid-fire double-clicks from racing
  // with the optimistic UI and the realtime subscription.
  const inFlight = useRef<Set<string>>(new Set());
  const tryClaim = useCallback((key: string): boolean => {
    if (inFlight.current.has(key)) return false;
    inFlight.current.add(key);
    return true;
  }, []);
  const release = useCallback((key: string) => {
    inFlight.current.delete(key);
  }, []);

  const handleAdminToggle = useCallback(async (userId: string, next: boolean) => {
    const key = `${userId}|isAdmin`;
    if (!tryClaim(key)) return;
    const target = allUsers.find(u => u.id === userId);
    setAllUsers(prev => {
      const out = prev.map(u => u.id === userId ? { ...u, isAdmin: next } : u);
      cachedUsers = out;
      return out;
    });
    // Toast immediately so the change feels instantaneous. The
    // realtime echo will dedupe (Pass 5) so the same message isn't
    // shown twice. On failure we toast the error and rollback.
    if (target) {
      showToast(
        next ? `${target.name} is now an admin` : `${target.name} is no longer an admin`,
        'success',
      );
    }
    const { error } = await updateUserIsAdmin(userId, next);
    release(key);
    if (error) {
      // Roll back on failure so the UI doesn't lie about the DB.
      setAllUsers(prev => {
        const out = prev.map(u => u.id === userId ? { ...u, isAdmin: !next } : u);
        cachedUsers = out;
        return out;
      });
      showToast(`Couldn’t save admin flag: ${error}`, 'warning');
    }
  }, [allUsers, showToast, tryClaim, release]);

  // Super-admin toggle - flips the primary role between 'super_admin'
  // and 'admin'. Off lands on 'admin' (not the original role) because
  // the toggle is only surfaced on the Admins / Super Admins tabs, so
  // 'admin' is the right neighbouring tier.
  const handleSuperAdminToggle = useCallback(async (userId: string, next: boolean) => {
    const key = `${userId}|role`;
    if (!tryClaim(key)) return;
    const target = allUsers.find(u => u.id === userId);
    if (!target) { release(key); return; }
    const newRole: UserRole = next ? 'super_admin' : 'admin';
    const prevRole = target.role;
    // Pass 9: super_admin always implies is_admin too. Demoting from
    // super_admin to admin keeps is_admin true (an admin is by
    // definition an admin); promoting to super_admin enforces it.
    setAllUsers(prev => {
      const out = prev.map(u => u.id === userId
        ? { ...u, role: newRole, isAdmin: u.isAdmin || newRole === 'super_admin' || newRole === 'admin' }
        : u);
      cachedUsers = out;
      return out;
    });
    showToast(
      next ? `${target.name} is now a super admin` : `${target.name} is no longer a super admin`,
      'success',
    );
    const { error } = await updateUserRole(userId, newRole);
    if (error) {
      setAllUsers(prev => {
        const out = prev.map(u => u.id === userId ? { ...u, role: prevRole } : u);
        cachedUsers = out;
        return out;
      });
      showToast(`Failed to change role: ${error}`, 'warning');
      release(key);
      return;
    }
    // Mirror is_admin to the DB so the elevation persists.
    if (newRole === 'super_admin' || newRole === 'admin') {
      void updateUserIsAdmin(userId, true);
    }
    release(key);
  }, [allUsers, showToast, tryClaim, release]);

  const userTable = useSortableTable(users);
  const adminTable = useSortableTable(admins);
  const superAdminTable = useSortableTable(superAdmins);

  const renderTable = (
    data: UserRow[],
    table: ReturnType<typeof useSortableTable<UserRow>>,
    labelCol: string,
    options: { showSuperToggle?: boolean; showAdminToggle?: boolean; showPromoteButton?: boolean } = {},
  ) => {
    const { showSuperToggle = false, showAdminToggle = true, showPromoteButton = false } = options;
    if (data.length === 0) {
      // Pass 3: distinguish "still loading the first time" from
      // "loaded, but this slice is empty". The flash of "No users
      // yet" while the network is still in flight read like a bug —
      // worse on slow connections — and made promotions feel less
      // stable since the list rebuilds after the optimistic write.
      if (!loaded) {
        return <p className="admin-detail-empty admin-users-loading">Loading {labelCol.toLowerCase()}s…</p>;
      }
      return <p className="admin-detail-empty">No {labelCol.toLowerCase()}s yet</p>;
    }
    return (
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh label={labelCol} sortKey="name" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Role" sortKey="role" currentSort={table.sort} onSort={table.handleSort} />
              {showAdminToggle && (
                <SortableTh label="Admin" sortKey="isAdmin" currentSort={table.sort} onSort={table.handleSort} />
              )}
              {showSuperToggle && (
                <SortableTh label="Super" sortKey="role" currentSort={table.sort} onSort={table.handleSort} />
              )}
              <SortableTh label="Gender" sortKey="gender" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Looks" sortKey="looksCount" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="SSO" sortKey="sso" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Joined" sortKey="createdAt" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Last Online" sortKey="lastSignIn" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Location" sortKey="location" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Saved" sortKey="saved" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Following" sortKey="followings" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Via Creator" sortKey="creator" currentSort={table.sort} onSort={table.handleSort} />
              <th style={{ width: showPromoteButton ? 180 : 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {table.sortedData.map(u => (
              <tr
                key={u.id}
                className="admin-clickable-row"
                onClick={() => navigate(`/admin/user/${u.id}`)}
              >
                <td className="admin-cell-name" title={u.email || undefined}>
                  <img className="admin-user-avatar-img" src={u.avatar} alt={u.name} />
                  {u.name}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <RoleBadge role={u.role} userId={u.id} onRoleChange={handleRoleChange} />
                </td>
                {showAdminToggle && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <label className="admin-toggle" title={u.isAdmin ? 'Revoke admin' : 'Make admin'}>
                      <input
                        type="checkbox"
                        checked={u.isAdmin}
                        onChange={(e) => handleAdminToggle(u.id, e.target.checked)}
                      />
                      <span className="admin-toggle-track" />
                    </label>
                  </td>
                )}
                {showSuperToggle && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <label className="admin-toggle" title={u.role === 'super_admin' ? 'Revoke super admin' : 'Make super admin'}>
                      <input
                        type="checkbox"
                        checked={u.role === 'super_admin'}
                        onChange={(e) => handleSuperAdminToggle(u.id, e.target.checked)}
                      />
                      <span className="admin-toggle-track" />
                    </label>
                  </td>
                )}
                <td>
                  {u.gender === 'male' ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', background: '#dbeafe', padding: '2px 8px', borderRadius: 999 }}>Male</span>
                  ) : u.gender === 'female' ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#be185d', background: '#fce7f3', padding: '2px 8px', borderRadius: 999 }}>Female</span>
                  ) : (
                    <span style={{ fontSize: 11, color: '#94a3b8' }}> - </span>
                  )}
                </td>
                <td>{u.looksCount > 0 ? u.looksCount : '-'}</td>
                <td><span className="admin-sso-badge">{u.sso}</span></td>
                <td className="admin-cell-muted">{u.createdAt}</td>
                <td className="admin-cell-muted">{u.lastSignIn}</td>
                <td className="admin-cell-muted">{u.location}</td>
                <td>{u.saved}</td>
                <td>{u.followings}</td>
                <td className="admin-cell-muted">{u.creator}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    {showPromoteButton && (
                      // "Move to admin" — single-click promote. Skips
                      // the seed-data ("content-*") rows since those
                      // aren't real auth users and have nothing to
                      // promote in the DB.
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary admin-row-promote"
                        onClick={() => handleAdminToggle(u.id, true)}
                        disabled={u.id.startsWith('content-')}
                        title={u.id.startsWith('content-') ? 'Seed creator — sign-up required first' : `Move ${u.name} to admin`}
                        aria-label={`Move ${u.name} to admin`}
                      >
                        Move to admin
                      </button>
                    )}
                    <button
                      type="button"
                      className="admin-row-delete"
                      onClick={() => handleDelete(u.id)}
                      aria-label={`Delete ${u.name}`}
                      title="Delete"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Users</h1>
          <p className="admin-page-subtitle">Manage users and admins</p>
        </div>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={async () => {
            if (auditingGender) return;
            setAuditingGender(true);
            const result = await auditAllUserGenders();
            setAuditingGender(false);
            showToast(`Gender audit - scanned ${result.scanned}, updated ${result.updated}, skipped ${result.skipped}${result.errors ? `, ${result.errors} errors` : ''}.`, result.errors ? 'warning' : 'success');
            if (result.updated > 0) {
              const profiles = await getProfiles();
              setAllUsers(prev => profiles.map(p => {
                const existing = prev.find(u => u.id === p.id);
                const row = profileToRow(p);
                return existing ? { ...row, looksCount: existing.looksCount } : row;
              }));
            }
          }}
          disabled={auditingGender}
          title="Walk every profile and infer gender from full_name where missing or different"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          {auditingGender ? 'Auditing…' : 'Gender audit'}
        </button>
      </div>
      {/* Order: Waitlist > Users > Admins > Super Admins. The
          previous Shoppers/Creators split was a false dichotomy —
          a "shopper" who publishes a look becomes a "creator" with
          no other state change, so showing them in two tables made
          the same person appear/disappear on role flips. One Users
          tab owns everyone who isn't elevated. The Incoming tab was
          a placeholder for a feature that never shipped — dropped. */}
      <div className="admin-tabs">
        <div className="admin-tab-group">
          <button className={`admin-tab ${activeTab === 'waitlist' ? 'active' : ''}`} onClick={() => setActiveTab('waitlist')}>
            Waitlist{waitlistIds.size > 0 && <span className="admin-tab-count">{waitlistIds.size}</span>}
          </button>
        </div>
        <div className="admin-tab-group">
          <button className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            Users{users.length > 0 && <span className="admin-tab-count">{users.length}</span>}
          </button>
        </div>
        <div className="admin-tab-group">
          <button className={`admin-tab ${activeTab === 'admins' ? 'active' : ''}`} onClick={() => setActiveTab('admins')}>
            Admins{admins.length > 0 && <span className="admin-tab-count">{admins.length}</span>}
          </button>
          <button className={`admin-tab admin-tab-sub ${activeTab === 'super-admins' ? 'active' : ''}`} onClick={() => setActiveTab('super-admins')}>
            Super Admins{superAdmins.length > 0 && <span className="admin-tab-count">{superAdmins.length}</span>}
          </button>
        </div>
      </div>

      {activeTab === 'waitlist' && <AdminWaitlistPanel />}
      {activeTab === 'users' && renderTable(users, userTable, 'User', { showAdminToggle: false, showPromoteButton: true })}
      {activeTab === 'admins' && renderTable(admins, adminTable, 'Admin', { showSuperToggle: true, showAdminToggle: false })}
      {activeTab === 'super-admins' && renderTable(superAdmins, superAdminTable, 'Super Admin', { showSuperToggle: true })}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

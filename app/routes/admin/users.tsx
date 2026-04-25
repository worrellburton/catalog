import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { getProfiles, updateUserRole, type Profile } from '~/services/profiles';
import { creators as lookCreators, looks } from '~/data/looks';
import type { UserRole } from '~/types/roles';
import { USER_ROLE_LABELS } from '~/types/roles';
import AdminWaitlistPanel from '~/components/AdminWaitlistPanel';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface UserRow {
  id: string;
  initials: string;
  name: string;
  avatar: string;
  sso: string;
  role: UserRole;
  createdAt: string;
  lastSignIn: string;
  looksCount: number;
  shopping: string;
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
    avatar: p.avatar_url || `https://i.pravatar.cc/40?u=${p.id}`,
    sso: p.provider === 'google' ? 'Google' : p.provider === 'phone' ? 'Phone' : 'SSO',
    role: p.role || 'shopper',
    createdAt: formatDate(p.created_at),
    lastSignIn: formatDateTime(p.last_sign_in_at),
    looksCount: 0,
    shopping: '-',
    location: '-',
    saved: 0,
    followings: 0,
    creator: '-',
  };
}

type Tab = 'shoppers' | 'shoppers-waitlist' | 'creators' | 'creators-incoming' | 'admins';

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
          right: 24,
          display: 'flex',
          flexDirection: 'column',
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

export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState<Tab>('shoppers');
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    getProfiles().then(profiles => setAllUsers(profiles.map(profileToRow)));
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 240);
  }, []);

  const showToast = useCallback((message: string, type: ToastType) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      dismissToast(id);
    }, 4000);
  }, [dismissToast]);

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
      return prev.map(u => u.id === userId ? { ...u, role: newRole } : u);
    });
  }, [showToast]);

  const shoppers = allUsers.filter(u => u.role === 'shopper');
  const dbCreators = allUsers.filter(u => u.role === 'creator');

  // Merge content creators from looks data with DB creators
  const contentCreators: UserRow[] = useMemo(() => {
    const dbNames = new Set(dbCreators.map(c => c.name.toLowerCase()));
    return Object.values(lookCreators)
      .filter(c => !dbNames.has(c.displayName.toLowerCase()))
      .map(c => ({
        id: `content-${c.name}`,
        initials: c.displayName.slice(0, 2).toUpperCase(),
        name: c.displayName,
        avatar: c.avatar,
        sso: '-',
        role: 'creator' as UserRole,
        createdAt: '-',
        lastSignIn: '-',
        looksCount: looksPerCreator[c.name] || 0,
        shopping: '-',
        location: '-',
        saved: 0,
        followings: 0,
        creator: '-',
      }));
  }, [dbCreators]);

  const creators = [...dbCreators, ...contentCreators];
  const admins = allUsers.filter(u => u.role === 'admin');

  const shopperTable = useSortableTable(shoppers);
  const creatorTable = useSortableTable(creators);
  const adminTable = useSortableTable(admins);

  const renderTable = (
    data: UserRow[],
    table: ReturnType<typeof useSortableTable<UserRow>>,
    labelCol: string,
  ) => {
    if (data.length === 0) {
      return <p className="admin-detail-empty">No {labelCol.toLowerCase()}s yet</p>;
    }
    return (
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh label={labelCol} sortKey="name" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Role" sortKey="role" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Looks" sortKey="looksCount" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="SSO" sortKey="sso" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Joined" sortKey="createdAt" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Last Sign In" sortKey="lastSignIn" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Shopping" sortKey="shopping" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Location" sortKey="location" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Saved" sortKey="saved" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Following" sortKey="followings" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Via Creator" sortKey="creator" currentSort={table.sort} onSort={table.handleSort} />
            </tr>
          </thead>
          <tbody>
            {table.sortedData.map(u => (
              <tr
                key={u.id}
                className="admin-clickable-row"
                onClick={() => navigate(`/admin/user/${u.id}`)}
              >
                <td className="admin-cell-name">
                  <img className="admin-user-avatar-img" src={u.avatar} alt={u.name} />
                  {u.name}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <RoleBadge role={u.role} userId={u.id} onRoleChange={handleRoleChange} />
                </td>
                <td>{u.looksCount > 0 ? u.looksCount : '-'}</td>
                <td><span className="admin-sso-badge">{u.sso}</span></td>
                <td className="admin-cell-muted">{u.createdAt}</td>
                <td className="admin-cell-muted">{u.lastSignIn}</td>
                <td>{u.shopping}</td>
                <td className="admin-cell-muted">{u.location}</td>
                <td>{u.saved}</td>
                <td>{u.followings}</td>
                <td className="admin-cell-muted">{u.creator}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Users</h1>
        <p className="admin-page-subtitle">Manage shoppers and creators</p>
      </div>
      <div className="admin-tabs">
        <div className="admin-tab-group">
          <button className={`admin-tab ${activeTab === 'shoppers' ? 'active' : ''}`} onClick={() => setActiveTab('shoppers')}>
            Shoppers{shoppers.length > 0 && <span className="admin-tab-count">{shoppers.length}</span>}
          </button>
          <button className={`admin-tab admin-tab-sub ${activeTab === 'shoppers-waitlist' ? 'active' : ''}`} onClick={() => setActiveTab('shoppers-waitlist')}>
            Waitlist
          </button>
        </div>
        <div className="admin-tab-group">
          <button className={`admin-tab ${activeTab === 'creators' ? 'active' : ''}`} onClick={() => setActiveTab('creators')}>
            Creators{creators.length > 0 && <span className="admin-tab-count">{creators.length}</span>}
          </button>
          <button className={`admin-tab admin-tab-sub ${activeTab === 'creators-incoming' ? 'active' : ''}`} onClick={() => setActiveTab('creators-incoming')}>
            Incoming
          </button>
        </div>
        <button className={`admin-tab ${activeTab === 'admins' ? 'active' : ''}`} onClick={() => setActiveTab('admins')}>
          Admins{admins.length > 0 && <span className="admin-tab-count">{admins.length}</span>}
        </button>
      </div>

      {activeTab === 'shoppers' && renderTable(shoppers, shopperTable, 'Shopper')}
      {activeTab === 'shoppers-waitlist' && <AdminWaitlistPanel />}
      {activeTab === 'creators' && renderTable(creators, creatorTable, 'Creator')}
      {activeTab === 'creators-incoming' && <p className="admin-detail-empty">No incoming creator applications</p>}
      {activeTab === 'admins' && renderTable(admins, adminTable, 'Admin')}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

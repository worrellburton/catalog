import { useState, useRef, useEffect } from 'react';
import { useNavigate } from '@remix-run/react';
import type { UserRole } from '~/types/roles';
import { USER_ROLE_LABELS } from '~/types/roles';

interface UserMenuUser {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  role?: UserRole;
}

interface UserMenuProps {
  onOpenBookmarks: () => void;
  onOpenMyLooks?: () => void;
  bookmarkCount: number;
  user?: UserMenuUser | null;
  onLogout?: () => void;
  onOpenDecks?: () => void;
}

export default function UserMenu({ onOpenBookmarks, onOpenMyLooks, bookmarkCount, user, onLogout, onOpenDecks }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // iOS Safari sometimes synthesises a phantom `click` after touchend at
  // the same screen position. If the menu closes between the original
  // touch and the synthetic click, that phantom click lands on whichever
  // LookCard happens to sit underneath — opening that look instead of
  // running the menu item's action. Wrap each item in this helper so we
  // can (1) close the menu, (2) defer the action by a frame so the
  // popout has finished unmounting, and (3) eat the residual event.
  const runItem = (action: () => void) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    requestAnimationFrame(() => action());
  };

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <div className="user-menu" ref={menuRef}>
      {open && (
        <>
          {/* Full-bleed scrim absorbs the residual touchend that iOS
              would otherwise replay as a synthetic click on the LookCard
              behind the menu. Tap-to-dismiss is handled here too. */}
          <div
            className="user-menu-scrim"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          />
          <div className="user-menu-popout">
          {user && (
            <>
              <div className="user-menu-header">
                {user.avatarUrl && (
                  <img src={user.avatarUrl} alt="" className="user-menu-avatar" />
                )}
                <div className="user-menu-identity">
                  {user.displayName && <span className="user-menu-name">{user.displayName}</span>}
                  {user.email && <span className="user-menu-email">{user.email}</span>}
                  {user.role && <span className={`user-menu-role user-menu-role-${user.role}`}>{USER_ROLE_LABELS[user.role]}</span>}
                </div>
              </div>
              <div className="user-menu-divider" />
            </>
          )}
          <button className="user-menu-item" onClick={runItem(onOpenBookmarks)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span>Bookmarks</span>
            {bookmarkCount > 0 && <span className="user-menu-badge">{bookmarkCount}</span>}
          </button>
          {onOpenMyLooks && (
            <button className="user-menu-item" onClick={runItem(onOpenMyLooks)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>My Looks</span>
            </button>
          )}
          <button className="user-menu-item" onClick={runItem(() => navigate('/generate'))}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span>Generate</span>
          </button>
          <button className="user-menu-item" onClick={runItem(() => navigate('/admin'))}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/></svg>
            <span>Admin</span>
          </button>
          {onOpenDecks && (
            <button className="user-menu-item" onClick={runItem(onOpenDecks)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="4" x2="9" y2="20"/></svg>
              <span>Decks</span>
            </button>
          )}
          {onLogout && (
            <>
              <div className="user-menu-divider" />
              <button className="user-menu-item" onClick={runItem(onLogout)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>Log out</span>
              </button>
            </>
          )}
          </div>
        </>
      )}
      <button
        className={`user-menu-trigger ${open ? 'active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 21a8 8 0 0 1 16 0"/>
        </svg>
      </button>
    </div>
  );
}

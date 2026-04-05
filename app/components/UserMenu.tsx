import { useState, useRef, useEffect } from 'react';
import { useNavigate } from '@remix-run/react';

interface UserMenuUser {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

interface UserMenuProps {
  onOpenBookmarks: () => void;
  bookmarkCount: number;
  user?: UserMenuUser | null;
  onLogout?: () => void;
}

export default function UserMenu({ onOpenBookmarks, bookmarkCount, user, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
                </div>
              </div>
              <div className="user-menu-divider" />
            </>
          )}
          <button className="user-menu-item" onClick={() => { onOpenBookmarks(); setOpen(false); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span>Bookmarks</span>
            {bookmarkCount > 0 && <span className="user-menu-badge">{bookmarkCount}</span>}
          </button>
          <button className="user-menu-item" onClick={() => { navigate('/admin'); setOpen(false); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/></svg>
            <span>Admin</span>
          </button>
          {onLogout && (
            <>
              <div className="user-menu-divider" />
              <button className="user-menu-item" onClick={() => { onLogout(); setOpen(false); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>Log out</span>
              </button>
            </>
          )}
        </div>
      )}
      <button
        className={`user-menu-trigger ${open ? 'active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="user-menu-trigger-avatar" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 21a8 8 0 0 1 16 0"/>
          </svg>
        )}
      </button>
    </div>
  );
}

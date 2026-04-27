import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from '@remix-run/react';
import type { UserRole } from '~/types/roles';
import { USER_ROLE_LABELS } from '~/types/roles';
import type { Look, Product } from '~/data/looks';

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
  // Graphical surfaces — each is optional so the menu degrades gracefully
  // for surfaces that don't pass them in.
  recentProducts?: Product[];
  savedLooks?: Look[];
  savedProducts?: Product[];
  onOpenLook?: (look: Look) => void;
  onOpenProduct?: (product: Product) => void;
}

const STRIP_LIMIT = 8;

/** Single tile inside one of the menu strips. Click → open the underlying
 *  surface. Square 56px so the strip stays compact. */
function MiniTile({ src, label, onClick }: { src?: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className="user-menu-tile" onClick={onClick} aria-label={label}>
      {src
        ? <img src={src} alt="" loading="lazy" />
        : <span className="user-menu-tile-placeholder" aria-hidden="true">{label.charAt(0).toUpperCase()}</span>
      }
    </button>
  );
}

export default function UserMenu({
  onOpenBookmarks,
  onOpenMyLooks,
  bookmarkCount,
  user,
  onLogout,
  onOpenDecks,
  recentProducts = [],
  savedLooks = [],
  savedProducts = [],
  onOpenLook,
  onOpenProduct,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  // Brief grace period after closing during which the scrim stays
  // mounted, even though the popout is gone. Catches the phantom click
  // iOS Safari dispatches after touchend (typically 0-300ms later) on
  // whatever element ended up beneath the user's finger.
  const [cooldown, setCooldown] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const runItem = useCallback((action: () => void) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    setCooldown(true);
    window.setTimeout(() => setCooldown(false), 350);
    requestAnimationFrame(() => action());
  }, []);

  // Tile click closes the menu before opening the target so the menu's
  // animation doesn't fight the overlay's entrance animation.
  const runTile = useCallback((action: () => void) => () => {
    setOpen(false);
    setCooldown(true);
    window.setTimeout(() => setCooldown(false), 350);
    requestAnimationFrame(() => action());
  }, []);

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

  const recents = recentProducts.slice(0, STRIP_LIMIT);
  const looks = savedLooks.slice(0, STRIP_LIMIT);
  const products = savedProducts.slice(0, STRIP_LIMIT);

  return (
    <div className="user-menu" ref={menuRef}>
      {(open || cooldown) && (
        <div
          className="user-menu-scrim"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(false); }}
        />
      )}
      {open && (
        <>
          <div className="user-menu-popout user-menu-popout--graphical">
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

            {/* Try it on — primary CTA. Sits at the top so it's the first
                thing a returning shopper sees. */}
            <button className="user-menu-cta" onClick={runItem(() => navigate('/generate'))}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              <span>Try it on</span>
              <svg className="user-menu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>

            {/* Recently viewed — products tapped in the trail, newest first. */}
            {recents.length > 0 && onOpenProduct && (
              <div className="user-menu-section">
                <div className="user-menu-section-title">Recently viewed</div>
                <div className="user-menu-strip">
                  {recents.map((p, i) => (
                    <MiniTile
                      key={`${p.brand}|${p.name}|${i}`}
                      src={p.image}
                      label={p.name || 'Product'}
                      onClick={runTile(() => onOpenProduct(p))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Saved looks. */}
            {looks.length > 0 && onOpenLook && (
              <div className="user-menu-section">
                <div className="user-menu-section-title">
                  Saved looks
                  <button className="user-menu-section-link" onClick={runItem(onOpenBookmarks)}>See all</button>
                </div>
                <div className="user-menu-strip">
                  {looks.map(l => (
                    <MiniTile
                      key={`look-${l.id}`}
                      src={l.products?.[0]?.image}
                      label={l.title || 'Look'}
                      onClick={runTile(() => onOpenLook(l))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Saved products. */}
            {products.length > 0 && onOpenProduct && (
              <div className="user-menu-section">
                <div className="user-menu-section-title">
                  Saved products
                  <button className="user-menu-section-link" onClick={runItem(onOpenBookmarks)}>See all</button>
                </div>
                <div className="user-menu-strip">
                  {products.map((p, i) => (
                    <MiniTile
                      key={`p-${p.brand}|${p.name}|${i}`}
                      src={p.image}
                      label={p.name || 'Product'}
                      onClick={runTile(() => onOpenProduct(p))}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="user-menu-divider" />

            {/* Secondary nav (full bookmarks, my catalog, admin/decks/logout). */}
            <button className="user-menu-item" onClick={runItem(onOpenBookmarks)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              <span>Bookmarks</span>
              {bookmarkCount > 0 && <span className="user-menu-badge">{bookmarkCount}</span>}
            </button>
            {onOpenMyLooks && (
              <button className="user-menu-item" onClick={runItem(onOpenMyLooks)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>My Catalog</span>
              </button>
            )}
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

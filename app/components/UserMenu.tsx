import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useNavigate } from '@remix-run/react';
import type { UserRole } from '~/types/roles';
import { USER_ROLE_LABELS } from '~/types/roles';
import type { Look, Product } from '~/data/looks';
import { useDeleteMode } from '~/hooks/useDeleteMode';
import { AvatarUpload } from './AvatarCropModal';
import { getWallet } from '~/services/earnings';
import { supabase } from '~/utils/supabase';

interface UserMenuUser {
  id?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  role?: UserRole;
}

interface UserMenuProps {
  onOpenBookmarks: () => void;
  onOpenMyLooks?: () => void;
  onOpenWallet?: () => void;
  bookmarkCount: number;
  user?: UserMenuUser | null;
  onLogout?: () => void;
  onOpenDecks?: () => void;
  // Graphical surfaces - each is optional so the menu degrades gracefully
  // for surfaces that don't pass them in.
  recentProducts?: Product[];
  savedLooks?: Look[];
  savedProducts?: Product[];
  onOpenLook?: (look: Look) => void;
  onOpenProduct?: (product: Product) => void;
  // Catalog gender filter - wired through for the super-admin
  // "Shopping for" toggle. The page already auto-syncs activeFilter
  // from the profile gender, so when the toggle first renders it
  // reflects the admin's own setting.
  activeFilter?: 'all' | 'men' | 'women';
  onChangeCatalogGender?: (next: 'all' | 'men' | 'women') => void;
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

function UserMenu({
  onOpenBookmarks,
  onOpenMyLooks,
  onOpenWallet,
  bookmarkCount,
  user,
  onLogout,
  onOpenDecks,
  recentProducts = [],
  savedLooks = [],
  savedProducts = [],
  onOpenLook,
  onOpenProduct,
  activeFilter,
  onChangeCatalogGender,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [deleteMode, setDeleteModeState] = useDeleteMode();
  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
  const renderedAvatarUrl = avatarOverride || user?.avatarUrl;
  const [cooldown, setCooldown] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [dotsConnected, setDotsConnected] = useState<boolean | null>(null);
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

  // Fetch wallet balance + Dots connection status when menu opens
  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    // Check if Dots is connected
    supabase
      .from('profiles')
      .select('is_payout_active')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        const connected = data?.is_payout_active ?? false;
        setDotsConnected(connected);
        if (connected) {
          getWallet(1, 1).then(w => {
            if (!cancelled) setWalletBalance(w.current_balance);
          }).catch(() => {});
        }
      })
      .catch(() => { if (!cancelled) setDotsConnected(false); });
    return () => { cancelled = true; };
  }, [open, user?.id]);

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
                  <div className="user-menu-avatar-wrap" key={renderedAvatarUrl || 'placeholder'}>
                    <AvatarUpload
                      userId={user.id}
                      currentUrl={renderedAvatarUrl}
                      fallbackInitial={user.displayName?.charAt(0) || user.email?.charAt(0)}
                      onUploaded={setAvatarOverride}
                    />
                  </div>
                  <div className="user-menu-identity">
                    {user.displayName && <span className="user-menu-name">{user.displayName}</span>}
                    {user.email && <span className="user-menu-email">{user.email}</span>}
                    {user.role && <span className={`user-menu-role user-menu-role-${user.role}`}>{USER_ROLE_LABELS[user.role]}</span>}
                    {dotsConnected && walletBalance !== null && walletBalance > 0 && onOpenWallet && (
                      <button
                        onClick={runItem(onOpenWallet)}
                        style={{
                          marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', background: '#dcfce7', color: '#15803d',
                          border: '1px solid #bbf7d0', borderRadius: 20,
                          fontSize: 12, fontWeight: 700, cursor: 'pointer', width: 'fit-content',
                        }}
                        title="Open Wallet"
                      >
                        <span>$</span>
                        <span>{walletBalance.toFixed(2)}</span>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="user-menu-divider" />
              </>
            )}

            {/* Try it on - primary CTA. Sits at the top so it's the first
                thing a returning shopper sees. */}
            <button className="user-menu-cta" onClick={runItem(() => navigate('/generate'))}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              <span>Try it on</span>
              <svg className="user-menu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>

            {/* Style — sibling of Try it on. Generates a 4-image style
                reference sheet from the same context (photos, height, age)
                using gpt-image-1 + nano-banana-2 via fal.ai. */}
            <button className="user-menu-cta" onClick={runItem(() => navigate('/style'))}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.9 5.85h6.15l-4.97 3.62 1.9 5.85L12 13.7l-4.98 3.62 1.9-5.85L3.95 7.85h6.15z"/><circle cx="12" cy="12" r="9" opacity="0.25"/></svg>
              <span>Style</span>
              <svg className="user-menu-cta-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>

            {/* Recently viewed - products tapped in the trail, newest first. */}
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                <span>My Catalog</span>
              </button>
            )}
            {onOpenWallet && dotsConnected === false && (
              <button className="user-menu-item" onClick={runItem(onOpenWallet)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                <span>Setup Earnings</span>
              </button>
            )}
            {onOpenWallet && dotsConnected === true && (
              <button className="user-menu-item" onClick={runItem(onOpenWallet)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                <span>Wallet</span>
                {walletBalance !== null && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: walletBalance > 0 ? '#15803d' : 'var(--text-muted, #888)' }}>
                    ${walletBalance.toFixed(2)}
                  </span>
                )}
              </button>
            )}
            {isSuperAdmin && (
              <div className="user-menu-item-flyout-wrap">
                <button className="user-menu-item user-menu-item-flyout" type="button" onClick={runItem(() => navigate('/import'))}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Import</span>
                  <svg className="user-menu-item-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <div className="user-menu-flyout" role="menu">
                  <button className="user-menu-flyout-item" onClick={runItem(() => navigate('/import?source=shopmy'))}>
                    Shop.my
                  </button>
                  <button className="user-menu-flyout-item" onClick={runItem(() => navigate('/import?source=ltk'))}>
                    LTK
                  </button>
                  <button className="user-menu-flyout-item" onClick={runItem(() => navigate('/import?source=amazon'))}>
                    Amazon Storefront
                  </button>
                </div>
              </div>
            )}
            {isAdmin && (
              <button className="user-menu-item" onClick={runItem(() => navigate('/admin'))}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/></svg>
                <span>Admin</span>
              </button>
            )}
            {onChangeCatalogGender && (
              <div className="user-menu-item user-menu-item--segmented" role="group" aria-label="Shopping for">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 21a8 8 0 0 1 16 0"/>
                </svg>
                <span>Shopping for</span>
                <div className="user-menu-segmented" aria-hidden="false">
                  <button
                    type="button"
                    className={`user-menu-segmented-btn ${activeFilter === 'men' ? 'is-on' : ''}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChangeCatalogGender('men'); }}
                    aria-pressed={activeFilter === 'men'}
                  >
                    Men
                  </button>
                  <button
                    type="button"
                    className={`user-menu-segmented-btn ${activeFilter === 'women' ? 'is-on' : ''}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChangeCatalogGender('women'); }}
                    aria-pressed={activeFilter === 'women'}
                  >
                    Women
                  </button>
                </div>
              </div>
            )}
            {isSuperAdmin && (
              <button
                className={`user-menu-item user-menu-item--toggle ${deleteMode ? 'is-on' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteModeState(!deleteMode);
                }}
                role="switch"
                aria-checked={deleteMode}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                <span>Delete mode</span>
                <span className={`user-menu-switch ${deleteMode ? 'is-on' : ''}`} aria-hidden="true">
                  <span className="user-menu-switch-thumb" />
                </span>
              </button>
            )}
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

// Memoized - _index.tsx re-renders on every search keystroke and overlay
// open. Without memo + stable callbacks from the parent, the menu re-ran
// its avatar / strip layout for every state change.
export default memo(UserMenu);

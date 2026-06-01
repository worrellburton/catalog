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
  onOpenProfile?: () => void;
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
  /** Open a creator's catalog in-app. When provided, the Following
   *  section uses it for instant transitions instead of a full
   *  /c/<handle> page reload. */
  onOpenCreator?: (handle: string) => void;
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
  onOpenProfile,
  bookmarkCount,
  user,
  onLogout,
  onOpenDecks,
  recentProducts = [],
  savedLooks = [],
  savedProducts = [],
  onOpenLook,
  onOpenProduct,
  onOpenCreator,
  activeFilter,
  onChangeCatalogGender,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  // Mobile-only: opens a full-screen Account page instead of the popout.
  // The origin (avatar's center, in viewport coords) drives the clip-path
  // reveal animation so the page appears to grow out of the tapped avatar.
  const [pageOpen, setPageOpen] = useState(false);
  const [pageOrigin, setPageOrigin] = useState<{ x: number; y: number } | null>(null);
  const [deleteMode, setDeleteModeState] = useDeleteMode();
  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
  const renderedAvatarUrl = avatarOverride || user?.avatarUrl;
  const [cooldown, setCooldown] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [dotsConnected, setDotsConnected] = useState<boolean | null>(null);
  // Invite-and-earn: the signed-in creator's referral link + running stats.
  const [invite, setInvite] = useState<{ handle: string | null; link: string | null; count: number; earnedCents: number } | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();

  // Decide which surface the trigger should open: full-page on mobile,
  // the classic popout on desktop. Capture the avatar's center at click
  // time so the page can reveal outward from that exact point.
  const handleTriggerClick = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPageOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      setOpen(false);
      setPageOpen(true);
    } else {
      setOpen(o => !o);
    }
  }, []);

  // Close the page, but let the close animation play first (reverse of
  // the reveal) before unmounting.
  const [pageClosing, setPageClosing] = useState(false);
  const closePage = useCallback(() => {
    setPageClosing(true);
    window.setTimeout(() => {
      setPageOpen(false);
      setPageClosing(false);
    }, 380);
  }, []);

  // Super-admin sub-section visibility within the page. Only super-admins see
  // a small icon at the bottom; tapping it flips this to true and the body
  // swaps from the consumer list to the admin-only list (Import / Admin /
  // Decks / Delete mode). A back chevron in the header returns. Reset on
  // page close so re-opening always lands on the consumer view.
  const [superSection, setSuperSection] = useState(false);
  useEffect(() => {
    if (!pageOpen) setSuperSection(false);
  }, [pageOpen]);

  // When an action runs from the page, close the page first (with its
  // animation), then dispatch the action — same pattern as runTile, just
  // routed through the page lifecycle.
  const runPageItem = useCallback((action: () => void) => () => {
    closePage();
    setCooldown(true);
    window.setTimeout(() => setCooldown(false), 420);
    window.setTimeout(action, 380);
  }, [closePage]);

  // Escape closes the page too.
  useEffect(() => {
    if (!pageOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePage(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pageOpen, closePage]);

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

  // Fetch invite link + referral stats when the menu/page opens.
  useEffect(() => {
    if ((!open && !pageOpen) || !user?.id) return;
    let cancelled = false;
    import('~/services/referrals').then(({ getMyInviteInfo }) => {
      getMyInviteInfo().then(info => { if (!cancelled) setInvite(info); });
    });
    return () => { cancelled = true; };
  }, [open, pageOpen, user?.id]);

  // Share / copy the invite link. Native share sheet where available
  // (mobile), clipboard copy fallback with a brief "Copied" confirmation.
  const handleInvite = useCallback(() => {
    const link = invite?.link;
    if (!link) return;
    const shareData = {
      title: 'Catalog',
      text: 'Join my catalog on Catalog — skip the waitlist:',
      url: link,
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share(shareData).catch(() => {});
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => {
        setInviteCopied(true);
        window.setTimeout(() => setInviteCopied(false), 1800);
      }).catch(() => {});
    }
  }, [invite]);

  // Fetch wallet balance + Dots connection status when menu opens
  useEffect(() => {
    if ((!open && !pageOpen) || !user?.id) return;
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
          getWallet(1, 1).then(
            w => { if (!cancelled) setWalletBalance(w.current_balance); },
            () => {},
          );
        }
      }, () => { if (!cancelled) setDotsConnected(false); });
    return () => { cancelled = true; };
  }, [open, pageOpen, user?.id]);

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
                <div
                  className={`user-menu-header${onOpenProfile ? ' user-menu-header--clickable' : ''}`}
                  onClick={onOpenProfile ? runItem(onOpenProfile) : undefined}
                  role={onOpenProfile ? 'button' : undefined}
                  tabIndex={onOpenProfile ? 0 : undefined}
                  onKeyDown={onOpenProfile ? (e) => { if (e.key === 'Enter' || e.key === ' ') runItem(onOpenProfile)(e as unknown as React.MouseEvent); } : undefined}
                  title={onOpenProfile ? 'Edit profile' : undefined}
                >
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
                        onClick={(e) => { e.stopPropagation(); runItem(onOpenWallet)(e); }}
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
                  {onOpenProfile && (
                    <svg className="user-menu-header-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  )}
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

            {/* Secondary nav (following, full bookmarks, my catalog,
                admin/decks/logout). Following sits above Bookmarks
                so the creators you've opted into reading rank ahead
                of the things you've passively saved. */}
            <FollowingMenuItem onOpenCreator={(handle) => {
              setOpen(false);
              if (onOpenCreator) onOpenCreator(handle);
              else if (typeof window !== 'undefined') window.location.assign(`/c/${handle}`);
            }} />
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

      {/* Mobile full-page Account — replaces the popout on ≤768px. The reveal
          uses a clip-path circle that grows from the avatar's tapped position
          to cover the screen, and content staggers in after the wipe. */}
      {pageOpen && (
        <div
          className={`user-menu-page ${pageClosing ? 'is-closing' : 'is-open'}`}
          style={pageOrigin ? { '--ump-x': `${pageOrigin.x}px`, '--ump-y': `${pageOrigin.y}px` } as React.CSSProperties : undefined}
          role="dialog"
          aria-label="Account"
        >
          <header className="user-menu-page-top">
            <button
              className="user-menu-page-back"
              onClick={superSection ? () => setSuperSection(false) : closePage}
              aria-label={superSection ? 'Back to account' : 'Close account'}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
            </button>
            <h1 className="user-menu-page-title">{superSection ? 'Super Admin' : 'Account'}</h1>
            <span style={{ width: 22 }} aria-hidden="true" />
          </header>

          <div className="user-menu-page-body">
            {!superSection && user && (
              <div className="user-menu-page-hero">
                <div className="user-menu-page-avatar-wrap">
                  <AvatarUpload
                    userId={user.id}
                    currentUrl={renderedAvatarUrl}
                    fallbackInitial={user.displayName?.charAt(0) || user.email?.charAt(0)}
                    onUploaded={setAvatarOverride}
                    className="user-menu-page-avatar-upload"
                  />
                </div>
                <button
                  type="button"
                  className="user-menu-page-identity-btn"
                  onClick={onOpenProfile ? runPageItem(onOpenProfile) : undefined}
                  aria-label="Edit profile"
                >
                  <span className="user-menu-page-identity">
                    {user.displayName && <span className="user-menu-page-name">{user.displayName}</span>}
                    {user.email && <span className="user-menu-page-email">{user.email}</span>}
                    {user.role && <span className={`user-menu-role user-menu-role-${user.role}`} style={{ marginTop: 4 }}>{USER_ROLE_LABELS[user.role]}</span>}
                  </span>
                  {onOpenProfile && (
                    <svg className="user-menu-page-hero-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                  )}
                </button>
              </div>
            )}

            {!superSection && (
              <>
                <button className="user-menu-page-cta" onClick={runPageItem(() => navigate('/generate'))}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  <span>Try it on</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="user-menu-page-cta-chev"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <button className="user-menu-page-cta" onClick={runPageItem(() => navigate('/style'))}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.9 5.85h6.15l-4.97 3.62 1.9 5.85L12 13.7l-4.98 3.62 1.9-5.85L3.95 7.85h6.15z"/></svg>
                  <span>Style</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="user-menu-page-cta-chev"><polyline points="9 18 15 12 9 6"/></svg>
                </button>

                <PageRow icon="bookmark" label="Bookmarks" badge={bookmarkCount > 0 ? bookmarkCount : undefined} onClick={runPageItem(onOpenBookmarks)} />
                {onOpenMyLooks && (
                  <PageRow icon="grid" label="My Catalog" onClick={runPageItem(onOpenMyLooks)} />
                )}
                {onOpenWallet && dotsConnected === false && (
                  <PageRow icon="star" label="Setup Earnings" onClick={runPageItem(onOpenWallet)} />
                )}
                {onOpenWallet && dotsConnected === true && (
                  <PageRow icon="wallet" label="Wallet" trailing={walletBalance !== null ? `$${walletBalance.toFixed(2)}` : undefined} onClick={runPageItem(onOpenWallet)} />
                )}
                {onChangeCatalogGender && (
                  <div className="user-menu-page-row user-menu-page-row--segmented">
                    <span className="user-menu-page-row-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
                    </span>
                    <span className="user-menu-page-row-label">Shopping for</span>
                    <div className="user-menu-segmented" style={{ marginLeft: 'auto' }}>
                      <button className={`user-menu-segmented-btn ${activeFilter === 'men' ? 'is-on' : ''}`} onClick={() => onChangeCatalogGender('men')}>Men</button>
                      <button className={`user-menu-segmented-btn ${activeFilter === 'women' ? 'is-on' : ''}`} onClick={() => onChangeCatalogGender('women')}>Women</button>
                    </div>
                  </div>
                )}

                {/* Invite & earn — share your catalog link; signups skip the
                    waitlist and you earn $0.25 each. Shows running earnings. */}
                {invite?.link && (
                  <button type="button" className="user-menu-page-row user-menu-invite-row" onClick={handleInvite}>
                    <span className="user-menu-page-row-icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    </span>
                    <span className="user-menu-page-row-label">
                      {inviteCopied ? 'Link copied!' : 'Invite a catalog & earn'}
                    </span>
                    {invite.earnedCents > 0 && (
                      <span className="user-menu-page-row-trailing">${(invite.earnedCents / 100).toFixed(2)}</span>
                    )}
                    <svg className="user-menu-page-row-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  </button>
                )}

                {onLogout && (
                  <PageRow icon="logout" label="Log out" onClick={runPageItem(onLogout)} variant="danger" />
                )}

                {/* Super-admin entry — only visible to super_admin role, sits
                    on its own at the bottom of the consumer list. Routes to
                    the super-admin sub-section instead of cluttering the
                    main menu with admin-only chrome. */}
                {isSuperAdmin && (
                  <button
                    type="button"
                    className="user-menu-page-super-entry"
                    onClick={() => setSuperSection(true)}
                    aria-label="Open Super Admin"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 4v6c0 5-3.7 9.4-9 10-5.3-.6-9-5-9-10V6l9-4z"/></svg>
                    <span>Super Admin</span>
                  </button>
                )}
              </>
            )}

            {superSection && isSuperAdmin && (
              <>
                <PageRow icon="shield" label="Admin" onClick={runPageItem(() => navigate('/admin'))} />
                <PageRow icon="import" label="Import" onClick={runPageItem(() => navigate('/import'))} />
                {onOpenDecks && (
                  <PageRow icon="deck" label="Decks" onClick={runPageItem(onOpenDecks)} />
                )}
                <div className={`user-menu-page-row user-menu-page-row--toggle ${deleteMode ? 'is-on' : ''}`} onClick={() => setDeleteModeState(!deleteMode)} role="switch" aria-checked={deleteMode}>
                  <span className="user-menu-page-row-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                  </span>
                  <span className="user-menu-page-row-label">Delete mode</span>
                  <span className={`user-menu-switch ${deleteMode ? 'is-on' : ''}`} aria-hidden="true" style={{ marginLeft: 'auto' }}>
                    <span className="user-menu-switch-thumb" />
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <button
        ref={triggerRef}
        className={`user-menu-trigger ${open || pageOpen ? 'active' : ''}${renderedAvatarUrl ? ' has-avatar' : (user ? ' has-initial' : '')}`}
        onClick={handleTriggerClick}
        aria-label="Account menu"
      >
        {renderedAvatarUrl ? (
          <img
            src={renderedAvatarUrl}
            alt=""
            className="user-menu-trigger-avatar"
            referrerPolicy="no-referrer"
          />
        ) : user ? (
          <span className="user-menu-trigger-initial" aria-hidden="true">
            {(user.displayName?.trim() || user.email?.trim() || 'U').charAt(0).toUpperCase()}
          </span>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 21a8 8 0 0 1 16 0"/>
          </svg>
        )}
      </button>
    </div>
  );
}

// Reusable row for the mobile Account page. The icon is keyed by name so
// the row component stays compact; the SVGs are inline so we don't drag in
// an icon library.
type PageRowIcon = 'bookmark' | 'grid' | 'star' | 'wallet' | 'shield' | 'import' | 'deck' | 'logout';
function PageRow({ icon, label, onClick, badge, trailing, variant }: {
  icon: PageRowIcon;
  label: string;
  onClick: () => void;
  badge?: number;
  trailing?: string;
  variant?: 'danger';
}) {
  return (
    <button type="button" className={`user-menu-page-row ${variant === 'danger' ? 'is-danger' : ''}`} onClick={onClick}>
      <span className="user-menu-page-row-icon" aria-hidden="true">
        {icon === 'bookmark' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>}
        {icon === 'grid' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>}
        {icon === 'star' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
        {icon === 'wallet' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>}
        {icon === 'shield' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/></svg>}
        {icon === 'import' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
        {icon === 'deck' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="4" x2="9" y2="20"/></svg>}
        {icon === 'logout' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>}
      </span>
      <span className="user-menu-page-row-label">{label}</span>
      {badge != null && <span className="user-menu-page-row-badge">{badge}</span>}
      {trailing && <span className="user-menu-page-row-trailing">{trailing}</span>}
      <svg className="user-menu-page-row-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  );
}

// Memoized - _index.tsx re-renders on every search keystroke and overlay
// open. Without memo + stable callbacks from the parent, the menu re-ran
// its avatar / strip layout for every state change.
export default memo(UserMenu);

/**
 * "Following N" menu item — surfaces the list of creators the user
 * follows directly in the user menu. Fetches lazily (only when the
 * menu has rendered) and shows the first 6 handles as clickable chips
 * with a "See all" link to the full list. No-op when the user follows
 * nobody yet (the row hides instead of rendering "Following 0").
 */
function FollowingMenuItem({ onOpenCreator }: { onOpenCreator: (handle: string) => void }) {
  const [handles, setHandles] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import('~/services/follows').then(({ getMyFollowing }) => {
      getMyFollowing().then(list => { if (!cancelled) setHandles(list); });
    });
    return () => { cancelled = true; };
  }, []);
  if (!handles || handles.length === 0) return null;
  return (
    <div>
      <button
        className="user-menu-item"
        onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="8.5" cy="7" r="4"/>
          <polyline points="17 11 19 13 23 9"/>
        </svg>
        <span>Following</span>
        <span className="user-menu-badge">{handles.length}</span>
      </button>
      {expanded && (
        <div style={{ padding: '4px 14px 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {handles.slice(0, 12).map(h => (
            <button
              key={h}
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenCreator(h); }}
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                color: '#0f172a',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              @{h}
            </button>
          ))}
          {handles.length > 12 && (
            <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>
              +{handles.length - 12} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

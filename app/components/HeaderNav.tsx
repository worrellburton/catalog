// imports
import { useCallback, useEffect, useRef, useState } from 'react';
import ProductsMegaMenu from '~/components/ProductsMegaMenu';
import {
  DIRECTORY_KINDS,
  DIRECTORY_LABELS,
  type DirectoryGender,
  type DirectoryKind,
  type DirectoryType,
} from '~/services/directory';
import '~/styles/header-nav.css';

// types
interface HeaderNavProps {
  active: DirectoryKind | null;
  onOpen: (kind: DirectoryKind) => void;
  gender: DirectoryGender;
  onChangeGender: (g: DirectoryGender) => void;
  onOpenType: (type: DirectoryType) => void;
}

// constants
const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 160;

// main logic
/**
 * Primary site nav beside the wordmark: Creators · Brands · Products ·
 * Catalogs. Hovering (or focusing) Products drops the full-width mega
 * menu; the menu stays open while the pointer is over it and closes a
 * beat after it leaves, so crossing the gap doesn't snap it shut.
 */
export default function HeaderNav({ active, onOpen, gender, onChangeGender, onOpenType }: HeaderNavProps) {
  const [megaOpen, setMegaOpen] = useState(false);
  const timer = useRef<number>(0);

  const scheduleOpen = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMegaOpen(true), OPEN_DELAY_MS);
  }, []);
  const scheduleClose = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMegaOpen(false), CLOSE_DELAY_MS);
  }, []);
  const closeNow = useCallback(() => {
    window.clearTimeout(timer.current);
    setMegaOpen(false);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!megaOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNow(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [megaOpen, closeNow]);

  return (
    <>
      <nav className="header-nav" aria-label="Browse">
        {DIRECTORY_KINDS.map(kind => {
          const isProducts = kind === 'products';
          return (
            <button
              key={kind}
              type="button"
              className={`header-nav-link${active === kind ? ' is-active' : ''}${isProducts && megaOpen ? ' is-open' : ''}`}
              aria-current={active === kind ? 'page' : undefined}
              aria-haspopup={isProducts ? 'true' : undefined}
              aria-expanded={isProducts ? megaOpen : undefined}
              onMouseEnter={isProducts ? scheduleOpen : closeNow}
              onMouseLeave={isProducts ? scheduleClose : undefined}
              onFocus={isProducts ? scheduleOpen : closeNow}
              onClick={() => { closeNow(); onOpen(kind); }}
            >
              {DIRECTORY_LABELS[kind]}
            </button>
          );
        })}
      </nav>
      <ProductsMegaMenu
        open={megaOpen}
        gender={gender}
        onChangeGender={onChangeGender}
        onOpenType={(t) => { closeNow(); onOpenType(t); }}
        onOpenAll={() => { closeNow(); onOpen('products'); }}
        onPointerStay={() => window.clearTimeout(timer.current)}
        onPointerLeave={scheduleClose}
      />
    </>
  );
}

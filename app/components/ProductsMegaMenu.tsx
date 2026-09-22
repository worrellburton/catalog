// imports
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import GenderLens from '~/components/directory/GenderLens';
import TypeIcon from '~/components/directory/TypeIcon';
import { groupByDepartment } from '~/components/directory/ProductsDirectory';
import { listDirectoryTypes, type DirectoryGender, type DirectoryType } from '~/services/directory';

// types
interface ProductsMegaMenuProps {
  open: boolean;
  gender: DirectoryGender;
  onChangeGender: (g: DirectoryGender) => void;
  onOpenType: (type: DirectoryType) => void;
  onOpenAll: () => void;
  /** Pointer entered the panel: cancel any pending close. */
  onPointerStay: () => void;
  /** Pointer left the panel: schedule a close. */
  onPointerLeave: () => void;
}

// main logic
/**
 * Full-width panel under the header: every product type with its icon and
 * the count for the chosen lens (All / Women / Men), grouped by department.
 * Types are loaded once the menu first opens and cached by the service.
 */
export default function ProductsMegaMenu({ open, gender, onChangeGender, onOpenType, onOpenAll, onPointerStay, onPointerLeave }: ProductsMegaMenuProps) {
  const [types, setTypes] = useState<DirectoryType[] | null>(null);
  const [everOpened, setEverOpened] = useState(false);
  // Portaled to <body>: rendered in place it would sit inside the fixed
  // <header>'s stacking context and inherit whatever opacity the hero state
  // gives the header, so the feed bled through the sheet.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortalTarget(document.body); }, []);

  useEffect(() => { if (open) setEverOpened(true); }, [open]);
  useEffect(() => {
    if (!everOpened || types) return;
    let cancelled = false;
    listDirectoryTypes().then(t => { if (!cancelled) setTypes(t); });
    return () => { cancelled = true; };
  }, [everOpened, types]);

  const groups = useMemo(() => groupByDepartment(types ?? [], gender), [types, gender]);
  const lensCounts = useMemo(() => types ? {
    all: types.reduce((n, t) => n + t.counts.all, 0),
    women: types.reduce((n, t) => n + t.counts.women, 0),
    men: types.reduce((n, t) => n + t.counts.men, 0),
  } : undefined, [types]);

  if (!portalTarget) return null;
  return createPortal(
    <div
      className={`mega-menu${open ? ' is-open' : ''}`}
      aria-hidden={!open}
      onMouseEnter={onPointerStay}
      onMouseLeave={onPointerLeave}
    >
      <div className="mega-menu-inner">
        <div className="mega-menu-head">
          <div>
            <span className="dir-eyebrow">Shop by type</span>
            <button type="button" className="mega-menu-all" onClick={onOpenAll} tabIndex={open ? 0 : -1}>
              All products
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>
            </button>
          </div>
          <GenderLens value={gender} onChange={onChangeGender} counts={lensCounts} />
        </div>
        {types === null ? (
          <div className="mega-menu-columns" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="mega-menu-col dir-skeleton" style={{ height: 180 }} />)}
          </div>
        ) : (
          <div className="mega-menu-columns">
            {groups.map(g => (
              <div key={g.department} className="mega-menu-col">
                <span className="mega-menu-dept">{g.department}</span>
                <ul className="mega-menu-list">
                  {g.types.map(t => (
                    <li key={t.id}>
                      <button type="button" className="mega-menu-type" onClick={() => onOpenType(t)} tabIndex={open ? 0 : -1}>
                        <span className="mega-menu-type-icon"><TypeIcon path={t.iconPath} size={22} /></span>
                        <span className="mega-menu-type-name">{t.name}</span>
                        <span className="mega-menu-type-count">{t.counts[gender]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    portalTarget,
  );
}

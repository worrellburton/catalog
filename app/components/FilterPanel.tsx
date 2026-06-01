import { useState, useCallback, useEffect } from 'react';
import { catalogNames } from '~/data/catalogNames';

export interface ActiveFilters {
  who: string[];
  style: string[];
  location: string[];
  price: string[];
  occasion: string[];
  type: string[];
  room: string[];
  vibe: string[];
  creator: string[];
}

interface FilterPanelProps {
  activeFilters: ActiveFilters;
  onFiltersChange: (filters: ActiveFilters) => void;
  onApply: () => void;
  onClose: () => void;
  /** True when the shopper has body data on file (height/weight). When
   *  false the "My Size" filter is hidden — there's nothing to match
   *  against. Sourced from useShopperBody by BottomBar. */
  hasSizeData?: boolean;
  mySizeOnly?: boolean;
  onMySizeChange?: (v: boolean) => void;
}

export function getEmptyFilters(): ActiveFilters {
  return { who: [], style: [], location: [], price: [], occasion: [], type: [], room: [], vibe: [], creator: [] };
}

export function hasActiveFilters(filters: ActiveFilters): boolean {
  return Object.values(filters).some(arr => arr.length > 0);
}

export function getCatalogName(filters: ActiveFilters, previous?: string): string {
  const allActive: string[] = [];
  Object.values(filters).forEach(arr => allActive.push(...arr));
  if (allActive.length === 0) return 'Build Your Catalog';
  const comboKey = [...allActive].sort().join('+');
  let pool = catalogNames[comboKey];
  if (!pool) {
    const options: string[] = [];
    allActive.forEach(v => { if (catalogNames[v]) options.push(...catalogNames[v]); });
    pool = options.length > 0 ? options : ['The Custom Catalog'];
  }
  // De-dupe the previous pick so a toggle ALWAYS visibly changes the
  // title — without this, Math.random can land on the same row and
  // the modal looks frozen even though state did update.
  if (previous && pool.length > 1) {
    const filtered = pool.filter(n => n !== previous);
    if (filtered.length > 0) pool = filtered;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Static option data ──────────────────────────────────────────────────
const LOCATIONS = ['NYC', 'LA', 'Paris', 'Tokyo', 'London', 'Milan', 'Seoul', 'Miami', 'Berlin', 'Sydney', 'Dubai', 'Mexico City', 'Toronto', 'Barcelona', 'Amsterdam'];

const PRICE_POINTS = [
  { val: 'under25', label: 'Under $25' },
  { val: '25-50', label: '$25–50' },
  { val: '50-100', label: '$50–100' },
  { val: '100-200', label: '$100–200' },
  { val: '200-500', label: '$200–500' },
  { val: '500plus', label: '$500+' },
];

const OCCASIONS = [
  { val: 'datenight', label: 'Date night' },
  { val: 'workout', label: 'Workout' },
  { val: 'brunch', label: 'Brunch' },
  { val: 'wedding', label: 'Wedding' },
  { val: 'festival', label: 'Festival' },
  { val: 'office', label: 'Office' },
];
const TYPES = [
  { val: 'tops', label: 'Tops' },
  { val: 'bottoms', label: 'Bottoms' },
  { val: 'shoes', label: 'Shoes' },
  { val: 'outerwear', label: 'Outerwear' },
  { val: 'hats', label: 'Hats' },
  { val: 'accessories', label: 'Accessories' },
];
const ROOMS = [
  { val: 'living', label: 'Living room' },
  { val: 'bedroom', label: 'Bedroom' },
  { val: 'kitchen', label: 'Kitchen' },
  { val: 'bathroom', label: 'Bathroom' },
  { val: 'outdoor', label: 'Outdoor' },
];
const VIBES = [
  { val: 'scandi', label: 'Scandinavian' },
  { val: 'maximalist', label: 'Maximalist' },
  { val: 'midcentury', label: 'Mid-century' },
  { val: 'cottagecore', label: 'Cottagecore' },
  { val: 'industrial', label: 'Industrial' },
];

// Icon set for the "who" + category rows. Inline so the panel carries no
// icon-library dependency.
function WhoIcon({ kind }: { kind: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'men') return <svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>;
  if (kind === 'women') return <svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/></svg>;
  if (kind === 'dogs') return <svg {...p}><path d="M10 5.2C10 3.8 8.4 2.7 6.5 3 3.7 3.5 2.4 9 2.5 10c.1.7 1.7 1.7 3.7 1 1.3-.5 2-1.5 2.3-2.5"/><path d="M14.3 5.2c0-1.4 1.6-2.5 3.5-2.2C20.6 3.5 21.9 9 21.8 10c-.1.7-1.7 1.7-3.7 1-1.3-.5-1.9-1.5-2.2-2.5"/><path d="M4.4 11.2A13 13 0 0 0 4 14.6C4 18.7 7.6 21 12 21s8-2.3 8-6.4a11.7 11.7 0 0 0-.5-3.3"/></svg>;
  return <svg {...p}><path d="M12 5c.7 0 1.4.1 2 .3 1.8-2 5-2.8 6.9-1 1 .9 1.1 2.6.4 3.8-.5.8-1.4 1.1-1.9 1.8C20.4 11.6 21 13.7 21 16c0 3.3-3.1 6-7 6h-4c-3.9 0-7-2.7-7-6 0-2.3.6-4.4 1.6-6.1-.5-.7-1.4-1-1.9-1.8-.7-1.2-.6-2.9.4-3.8 1.9-1.8 5.1-1 6.9 1 .7-.2 1.3-.3 2-.3Z"/></svg>;
}
function CatIcon({ kind }: { kind: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'fashion') return <svg {...p}><path d="M20.4 3.5 16 2l-4 3.5L8 2 3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.2a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.3-2.2Z"/></svg>;
  if (kind === 'homedecor') return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
  if (kind === 'wellness') return <svg {...p}><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/></svg>;
  return <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
}

export default function FilterPanel({ activeFilters, onFiltersChange, onApply, onClose, hasSizeData = false, mySizeOnly = false, onMySizeChange }: FilterPanelProps) {
  const [displayName, setDisplayName] = useState(() => getCatalogName(activeFilters));
  const [nameKey, setNameKey] = useState(0); // bumps to re-trigger the name morph animation
  const [locOpen, setLocOpen] = useState(false);

  const isActive = useCallback((cat: keyof ActiveFilters, val: string) => activeFilters[cat].includes(val), [activeFilters]);

  const toggle = useCallback((cat: keyof ActiveFilters, val: string) => {
    const updated: ActiveFilters = { ...activeFilters, [cat]: [...activeFilters[cat]] };
    const idx = updated[cat].indexOf(val);
    if (idx >= 0) updated[cat].splice(idx, 1);
    else updated[cat].push(val);
    onFiltersChange(updated);
    setDisplayName(prev => getCatalogName(updated, prev));
    setNameKey(k => k + 1);
  }, [activeFilters, onFiltersChange]);

  const reset = useCallback(() => {
    onFiltersChange(getEmptyFilters());
    setDisplayName('Build Your Catalog');
    setNameKey(k => k + 1);
    if (onMySizeChange) onMySizeChange(false);
  }, [onFiltersChange, onMySizeChange]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const showFashionSub = isActive('style', 'fashion');
  const showHomeSub = isActive('style', 'homedecor');
  const named = displayName !== 'Build Your Catalog';
  const anyActive = hasActiveFilters(activeFilters) || mySizeOnly;

  return (
    <div
      className="bcat-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bcat-panel" role="dialog" aria-label="Build your catalog" onClick={(e) => e.stopPropagation()}>
        <div className="bcat-aurora" aria-hidden="true" />

        <button className="bcat-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        {/* Recommended name — morphs on every toggle. */}
        <div className="bcat-namebar">
          <span className="bcat-spark" aria-hidden="true">
            <svg viewBox="0 0 100 100" width="26" height="26">
              <defs>
                <linearGradient id="bcat-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fff" /><stop offset="50%" stopColor="#cbd5e1" /><stop offset="100%" stopColor="#94a3b8" />
                </linearGradient>
              </defs>
              <path d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z" fill="url(#bcat-grad)" />
            </svg>
          </span>
          <div className="bcat-name-col">
            <span className="bcat-eyebrow">{named ? 'Your catalog' : 'Pick a few — we’ll name it'}</span>
            <h2 key={nameKey} className={`bcat-name${named ? ' is-named' : ''}`}>{displayName}</h2>
          </div>
          {anyActive && (
            <button className="bcat-reset" onClick={reset} aria-label="Reset">Reset</button>
          )}
        </div>

        <div className="bcat-scroll">
          {hasSizeData && onMySizeChange && (
            <section className="bcat-section">
              <div className="bcat-section-label">Personalize</div>
              <div className="bcat-chips">
                <button className={`bcat-chip${mySizeOnly ? ' is-on' : ''}`} onClick={() => onMySizeChange(!mySizeOnly)} aria-pressed={mySizeOnly}>
                  <span className="bcat-chip-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7"/><path d="M16 3l-4 4-4-4"/></svg></span>
                  My size only
                </button>
              </div>
            </section>
          )}

          <section className="bcat-section">
            <div className="bcat-section-label">Who&apos;s it for</div>
            <div className="bcat-chips">
              {[['men', 'Men'], ['women', 'Women'], ['dogs', 'Dogs'], ['cats', 'Cats']].map(([v, l]) => (
                <button key={v} className={`bcat-chip${isActive('who', v) ? ' is-on' : ''}`} onClick={() => toggle('who', v)} aria-pressed={isActive('who', v)}>
                  <span className="bcat-chip-ico"><WhoIcon kind={v} /></span>{l}
                </button>
              ))}
            </div>
          </section>

          <section className="bcat-section">
            <div className="bcat-section-label">Category</div>
            <div className="bcat-chips">
              {[['fashion', 'Fashion'], ['homedecor', 'Home decor'], ['wellness', 'Wellness'], ['electronics', 'Electronics']].map(([v, l]) => (
                <button key={v} className={`bcat-chip${isActive('style', v) ? ' is-on' : ''}`} onClick={() => toggle('style', v)} aria-pressed={isActive('style', v)}>
                  <span className="bcat-chip-ico"><CatIcon kind={v} /></span>{l}
                </button>
              ))}
            </div>

            <div className={`bcat-sub${showFashionSub ? ' is-open' : ''}`}>
              <div className="bcat-sub-label">By occasion</div>
              <div className="bcat-chips">
                {OCCASIONS.map(o => (
                  <button key={o.val} className={`bcat-chip bcat-chip--sm${isActive('occasion', o.val) ? ' is-on' : ''}`} onClick={() => toggle('occasion', o.val)}>{o.label}</button>
                ))}
              </div>
              <div className="bcat-sub-label">By type</div>
              <div className="bcat-chips">
                {TYPES.map(o => (
                  <button key={o.val} className={`bcat-chip bcat-chip--sm${isActive('type', o.val) ? ' is-on' : ''}`} onClick={() => toggle('type', o.val)}>{o.label}</button>
                ))}
              </div>
            </div>

            <div className={`bcat-sub${showHomeSub ? ' is-open' : ''}`}>
              <div className="bcat-sub-label">By room</div>
              <div className="bcat-chips">
                {ROOMS.map(o => (
                  <button key={o.val} className={`bcat-chip bcat-chip--sm${isActive('room', o.val) ? ' is-on' : ''}`} onClick={() => toggle('room', o.val)}>{o.label}</button>
                ))}
              </div>
              <div className="bcat-sub-label">By vibe</div>
              <div className="bcat-chips">
                {VIBES.map(o => (
                  <button key={o.val} className={`bcat-chip bcat-chip--sm${isActive('vibe', o.val) ? ' is-on' : ''}`} onClick={() => toggle('vibe', o.val)}>{o.label}</button>
                ))}
              </div>
            </div>
          </section>

          <section className="bcat-section">
            <div className="bcat-section-label">
              Where
              {activeFilters.location.length > 0 && <span className="bcat-section-count">{activeFilters.location.length}</span>}
            </div>
            <div className={`bcat-chips bcat-chips--loc${locOpen ? ' is-expanded' : ''}`}>
              {(locOpen ? LOCATIONS : LOCATIONS.slice(0, 6)).map(loc => (
                <button key={loc} className={`bcat-chip bcat-chip--sm${isActive('location', loc.toLowerCase()) ? ' is-on' : ''}`} onClick={() => toggle('location', loc.toLowerCase())}>{loc}</button>
              ))}
              {!locOpen && LOCATIONS.length > 6 && (
                <button className="bcat-chip bcat-chip--sm bcat-chip--more" onClick={() => setLocOpen(true)}>+{LOCATIONS.length - 6} more</button>
              )}
            </div>
          </section>

          <section className="bcat-section">
            <div className="bcat-section-label">Budget</div>
            <div className="bcat-chips">
              {PRICE_POINTS.map(pp => (
                <button key={pp.val} className={`bcat-chip bcat-chip--sm${isActive('price', pp.val) ? ' is-on' : ''}`} onClick={() => toggle('price', pp.val)}>{pp.label}</button>
              ))}
            </div>
          </section>
        </div>

        <button className="bcat-build" onClick={onApply}>
          {named ? `Build “${displayName}”` : 'Build my catalog'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>
      </div>
    </div>
  );
}


import { useState, useCallback, useRef, useEffect } from 'react';
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
}

export function getEmptyFilters(): ActiveFilters {
  return { who: [], style: [], location: [], price: [], occasion: [], type: [], room: [], vibe: [], creator: [] };
}

export function hasActiveFilters(filters: ActiveFilters): boolean {
  return Object.values(filters).some(arr => arr.length > 0);
}

export function getCatalogName(filters: ActiveFilters): string {
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
  return pool[Math.floor(Math.random() * pool.length)];
}

const allLocations = ['NYC', 'LA', 'Paris', 'Tokyo', 'London', 'Milan', 'Seoul', 'Miami', 'Berlin', 'Sydney', 'Dubai', 'Mexico City', 'Toronto', 'Barcelona', 'Amsterdam'];

const pricePoints = [
  { val: 'under25', label: 'Under $25' },
  { val: '25-50', label: '$25–$50' },
  { val: '50-100', label: '$50–$100' },
  { val: '100-200', label: '$100–$200' },
  { val: '200-500', label: '$200–$500' },
  { val: '500plus', label: '$500+' },
];

const bottomsKeywords = [
  { val: 'jeans', label: 'Jeans', x: -120, y: -40 },
  { val: 'trousers', label: 'Trousers', x: 120, y: -30 },
  { val: 'shorts', label: 'Shorts', x: -90, y: 50 },
  { val: 'skirts', label: 'Skirts', x: 100, y: 60 },
  { val: 'joggers', label: 'Joggers', x: 0, y: -70 },
  { val: 'leggings', label: 'Leggings', x: -50, y: 80 },
  { val: 'cargo', label: 'Cargo', x: 60, y: 90 },
  { val: 'chinos', label: 'Chinos', x: -140, y: 10 },
];

export default function FilterPanel({ activeFilters, onFiltersChange, onApply, onClose }: FilterPanelProps) {
  const [openSubPanel, setOpenSubPanel] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('Build Your Catalog');
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');
  const [bottomsExpanded, setBottomsExpanded] = useState(false);
  const locationRef = useRef<HTMLDivElement>(null);

  const filteredLocations = locationSearch
    ? allLocations.filter(l => l.toLowerCase().includes(locationSearch.toLowerCase()))
    : allLocations;

  // Close location dropdown on outside click
  useEffect(() => {
    if (!locationOpen) return;
    const handler = (e: MouseEvent) => {
      if (locationRef.current && !locationRef.current.contains(e.target as Node)) {
        setLocationOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [locationOpen]);

  const toggleFilter = useCallback((category: keyof ActiveFilters, value: string, expands?: string) => {
    const updated = { ...activeFilters, [category]: [...activeFilters[category]] };
    const idx = updated[category].indexOf(value);
    if (idx >= 0) {
      updated[category].splice(idx, 1);
      if (expands && openSubPanel === expands) setOpenSubPanel(null);
      if (value === 'bottoms') setBottomsExpanded(false);
    } else {
      updated[category].push(value);
      if (expands) setOpenSubPanel(expands);
      if (value === 'bottoms') setBottomsExpanded(true);
    }
    onFiltersChange(updated);
    const allActive: string[] = [];
    Object.values(updated).forEach(arr => allActive.push(...arr));
    if (allActive.length === 0) {
      setDisplayName('Build Your Catalog');
    } else {
      const comboKey = [...allActive].sort().join('+');
      let pool = catalogNames[comboKey];
      if (!pool) {
        const options: string[] = [];
        allActive.forEach(v => { if (catalogNames[v]) options.push(...catalogNames[v]); });
        pool = options.length > 0 ? options : ['The Custom Catalog'];
      }
      setDisplayName(pool[Math.floor(Math.random() * pool.length)]);
    }
  }, [activeFilters, onFiltersChange, openSubPanel]);

  const isActive = (category: keyof ActiveFilters, value: string) => activeFilters[category].includes(value);

  const selectedLocations = activeFilters.location;

  const btnText = displayName === 'Build Your Catalog' ? 'Build My Catalog' : `Build "${displayName}"`;

  return (
    <div className="filter-panel-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bottom-bar-filters" onClick={(e) => e.stopPropagation()}>
        <p className="filter-catalog-name">{displayName}</p>

        {/* Who's it for? */}
        <div className="filter-section">
          <div className="filter-section-label">Who&apos;s it for?</div>
          <div className="filter-options">
            <button className={`filter-option ${isActive('who', 'men') ? 'active' : ''}`} onClick={() => toggleFilter('who', 'men')}>
              <span className="filter-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg></span>Men
            </button>
            <button className={`filter-option ${isActive('who', 'women') ? 'active' : ''}`} onClick={() => toggleFilter('who', 'women')}>
              <span className="filter-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/></svg></span>Women
            </button>
            <button className={`filter-option ${isActive('who', 'dogs') ? 'active' : ''}`} onClick={() => toggleFilter('who', 'dogs')}>
              <span className="filter-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.725 1.722 3.656 1 1.261-.472 1.96-1.45 2.344-2.5"/><path d="M14.267 5.172c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309"/></svg></span>Dogs
            </button>
            <button className={`filter-option ${isActive('who', 'cats') ? 'active' : ''}`} onClick={() => toggleFilter('who', 'cats')}>
              <span className="filter-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.75 6.92-.95.97.92 1.12 2.62.42 3.81-.48.82-1.37 1.07-1.91 1.81C20.41 11.56 21 13.68 21 16c0 3.31-3.13 6-7 6h-4c-3.87 0-7-2.69-7-6 0-2.32.59-4.44 1.57-6.07-.54-.74-1.43-.99-1.91-1.81-.7-1.19-.55-2.89.42-3.81 1.89-1.8 5.14-1.05 6.92.95.65-.17 1.33-.26 2-.26Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/></svg></span>Cats
            </button>
          </div>
        </div>

        {/* Category */}
        <div className="filter-section">
          <div className="filter-section-label">Category</div>
          <div className="filter-options">
            <button className={`filter-option filter-expandable ${isActive('style', 'fashion') ? 'active' : ''}`} onClick={() => toggleFilter('style', 'fashion', 'fashion-sub')}>
              <span className="filter-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.38 3.46 16 2 12 5.5 8 2l-4.38 1.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/></svg></span>Fashion <svg className="expand-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button className={`filter-option filter-expandable ${isActive('style', 'homedecor') ? 'active' : ''}`} onClick={() => toggleFilter('style', 'homedecor', 'homedecor-sub')}>
              <span className="filter-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>Home Decor <svg className="expand-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button className={`filter-option ${isActive('style', 'wellness') ? 'active' : ''}`} onClick={() => toggleFilter('style', 'wellness')}>
              <span className="filter-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></span>Health &amp; Wellness
            </button>
            <button className={`filter-option ${isActive('style', 'electronics') ? 'active' : ''}`} onClick={() => toggleFilter('style', 'electronics')}>
              <span className="filter-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>Electronics
            </button>
          </div>

          {/* Fashion sub-panel */}
          <div className={`filter-sub-panel ${openSubPanel === 'fashion-sub' ? 'open' : ''}`}>
            <div className="filter-sub-group">
              <div className="filter-sub-label">By Occasion</div>
              <div className="filter-options">
                {[
                  { val: 'datenight', label: 'Date Night' },
                  { val: 'workout', label: 'Workout' },
                  { val: 'brunch', label: 'Brunch' },
                  { val: 'wedding', label: 'Wedding' },
                  { val: 'festival', label: 'Festival' },
                  { val: 'office', label: 'Office' },
                ].map(o => (
                  <button key={o.val} className={`filter-option filter-sub-option ${isActive('occasion', o.val) ? 'active' : ''}`} onClick={() => toggleFilter('occasion', o.val)}>{o.label}</button>
                ))}
              </div>
            </div>
            <div className="filter-sub-group">
              <div className="filter-sub-label">By Type</div>
              <div className="filter-options">
                {[
                  { val: 'tops', label: 'Tops' },
                  { val: 'bottoms', label: 'Bottoms' },
                  { val: 'shoes', label: 'Shoes' },
                  { val: 'outerwear', label: 'Outerwear' },
                  { val: 'hats', label: 'Hats' },
                  { val: 'accessories', label: 'Accessories' },
                ].map(o => (
                  <button
                    key={o.val}
                    className={`filter-option filter-sub-option ${isActive('type', o.val) ? 'active' : ''}`}
                    onClick={() => toggleFilter('type', o.val)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bottoms branch-out */}
            {bottomsExpanded && (
              <div className="bottoms-branch">
                <div className="bottoms-branch-center">Bottoms</div>
                {bottomsKeywords.map((kw, i) => (
                  <button
                    key={kw.val}
                    className={`bottoms-branch-keyword ${isActive('type', kw.val) ? 'active' : ''}`}
                    style={{
                      '--bx': `${kw.x}px`,
                      '--by': `${kw.y}px`,
                      animationDelay: `${i * 0.05}s`,
                    } as React.CSSProperties}
                    onClick={() => toggleFilter('type', kw.val)}
                  >
                    {kw.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Home Decor sub-panel */}
          <div className={`filter-sub-panel ${openSubPanel === 'homedecor-sub' ? 'open' : ''}`}>
            <div className="filter-sub-group">
              <div className="filter-sub-label">By Room</div>
              <div className="filter-options">
                {[
                  { val: 'living', label: 'Living Room' },
                  { val: 'bedroom', label: 'Bedroom' },
                  { val: 'kitchen', label: 'Kitchen' },
                  { val: 'bathroom', label: 'Bathroom' },
                  { val: 'outdoor', label: 'Outdoor' },
                ].map(o => (
                  <button key={o.val} className={`filter-option filter-sub-option ${isActive('room', o.val) ? 'active' : ''}`} onClick={() => toggleFilter('room', o.val)}>{o.label}</button>
                ))}
              </div>
            </div>
            <div className="filter-sub-group">
              <div className="filter-sub-label">By Vibe</div>
              <div className="filter-options">
                {[
                  { val: 'scandi', label: 'Scandinavian' },
                  { val: 'maximalist', label: 'Maximalist' },
                  { val: 'midcentury', label: 'Mid-Century' },
                  { val: 'cottagecore', label: 'Cottagecore' },
                  { val: 'industrial', label: 'Industrial' },
                ].map(o => (
                  <button key={o.val} className={`filter-option filter-sub-option ${isActive('vibe', o.val) ? 'active' : ''}`} onClick={() => toggleFilter('vibe', o.val)}>{o.label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Location — dropdown */}
        <div className="filter-section">
          <div className="filter-section-label">Location</div>
          <div className="filter-dropdown" ref={locationRef}>
            <button className="filter-dropdown-trigger" onClick={() => setLocationOpen(o => !o)}>
              <span>{selectedLocations.length > 0 ? selectedLocations.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(', ') : 'Select locations...'}</span>
              <svg className={`filter-dropdown-chevron ${locationOpen ? 'open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {locationOpen && (
              <div className="filter-dropdown-menu">
                <input
                  type="text"
                  className="filter-dropdown-search"
                  placeholder="Search..."
                  value={locationSearch}
                  onChange={(e) => setLocationSearch(e.target.value)}
                  autoFocus
                />
                <div className="filter-dropdown-list">
                  {filteredLocations.map(loc => (
                    <button
                      key={loc}
                      className={`filter-dropdown-item ${isActive('location', loc.toLowerCase()) ? 'active' : ''}`}
                      onClick={() => toggleFilter('location', loc.toLowerCase())}
                    >
                      <span className="filter-dropdown-check">{isActive('location', loc.toLowerCase()) ? '✓' : ''}</span>
                      {loc}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Price Range — selectable price point buttons */}
        <div className="filter-section">
          <div className="filter-section-label">Price Range</div>
          <div className="filter-price-points">
            {pricePoints.map(pp => (
              <button
                key={pp.val}
                className={`filter-price-point ${isActive('price', pp.val) ? 'active' : ''}`}
                onClick={() => toggleFilter('price', pp.val)}
              >
                {pp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Featured Creators */}
        <div className="filter-section filter-section-creators">
          <div className="filter-section-label">Featured Creators</div>
          <div className="filter-options">
            <button className={`filter-option filter-creator-option glow ${isActive('creator', '@lilywittman') ? 'active' : ''}`} onClick={() => toggleFilter('creator', '@lilywittman')}>
              <img className="filter-creator-avatar" src="https://i.pravatar.cc/100?img=47" alt="" />
              <span>@lilywittman</span>
            </button>
            <button className={`filter-option filter-creator-option glow ${isActive('creator', '@garrett') ? 'active' : ''}`} onClick={() => toggleFilter('creator', '@garrett')}>
              <img className="filter-creator-avatar" src="https://i.pravatar.cc/100?img=12" alt="" />
              <span>@garrett</span>
            </button>
          </div>
        </div>

        <button className="filter-apply-btn" onClick={onApply}>{btnText}</button>
      </div>
    </div>
  );
}

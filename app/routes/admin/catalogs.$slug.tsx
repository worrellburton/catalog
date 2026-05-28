import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from '@remix-run/react';
import {
  getCatalogBySlug,
  getLiveCatalogs,
  updateCatalogToggles,
  getCatalogSearchCounts,
  type Catalog,
  type CatalogSearchCounts,
} from '~/services/catalogs';
import {
  loadCatalogCreativePayload,
  CatalogCreativeDropdown,
  isAllCatalog,
  isUniverseCatalog,
  slugify,
  type CatalogCreativePayload,
} from './catalogs';
import { searchSuggestions } from '~/data/looks';
import CatalogActionBar from '~/components/CatalogActionBar';

// Featured/suggestion catalogs (and search terms not yet saved) have no
// row in the `catalogs` table — they only exist as a name that products
// and looks tag themselves with. Recover the human name from the slug so
// the page can still load content keyed by that name. Match a known
// suggestion first (preserves the exact original casing/spacing), then
// fall back to turning hyphens back into spaces.
function nameFromSlug(slug: string): string {
  const match = searchSuggestions.find(s => slugify(s) === slug);
  if (match) return match;
  return slug.replace(/-+/g, ' ').trim();
}

export default function AdminCatalogDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [persisted, setPersisted] = useState(false);
  const [creative, setCreative] = useState<CatalogCreativePayload | undefined>(undefined);
  const [catalogNames, setCatalogNames] = useState<string[]>([]);
  const [searchCounts, setSearchCounts] = useState<CatalogSearchCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    const dbCatalog = await getCatalogBySlug(slug);
    // Fall back to a synthetic catalog (name recovered from the slug) when
    // there's no DB row — featured suggestions and unsaved search terms
    // still have taggable content even without a `catalogs` record.
    const c: Catalog = dbCatalog ?? {
      id: `suggestion-${slug}`,
      slug,
      name: nameFromSlug(slug),
      description: null,
      themePrompt: null,
      gender: 'all',
      coverUrl: null,
      sortOrder: 0,
      isFeatured: true,
      status: 'live',
      isHome: false,
      filterGender: false,
      filterAge: false,
      boostTopConverting: false,
    };
    setCatalog(c);
    setPersisted(!!dbCatalog);

    // Same content the inline catalog-table dropdown renders: looks /
    // products matched by catalog_tags plus the live feed-search results
    // for this catalog name. No junction-table dependency, so catalogs
    // created from a search term populate immediately.
    const payload = await loadCatalogCreativePayload({ id: c.id, name: c.name });
    setCreative(payload);
    setLoading(false);

    getCatalogSearchCounts([c.name]).then(r => setSearchCounts(r[0] ?? null)).catch(() => {});
  }, [slug]);

  useEffect(() => { refresh(); }, [refresh]);

  // Other catalog names power the dropdown's bulk "Add to…" action.
  useEffect(() => {
    getLiveCatalogs()
      .then(rows => setCatalogNames(rows.map(r => r.name)))
      .catch(() => {});
  }, []);

  if (loading) {
    return <div className="admin-page"><p style={{ padding: 24, color: '#888' }}>Loading…</p></div>;
  }
  if (!catalog) {
    return (
      <div className="admin-page">
        <h1>Empty catalog</h1>
        <Link to="/admin/catalogs" className="admin-btn admin-btn-secondary">← Back to catalogs</Link>
      </div>
    );
  }

  const isAll = isAllCatalog(catalog.name);
  const isUniverse = isUniverseCatalog(catalog.name);

  return (
    <div className="admin-page">
      <Link to="/admin/catalogs" style={{ fontSize: 12, color: '#888', textDecoration: 'none' }}>← Catalogs</Link>
      <div className="admin-page-header" style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 640 }}>
          <h1 style={{ marginBottom: 4 }}>{catalog.name}</h1>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#888', marginBottom: 8 }}>{catalog.slug}</div>
          {catalog.description && <p style={{ margin: 0, color: '#555' }}>{catalog.description}</p>}
        </div>
        <CatalogActionBar catalog={{ id: catalog.id, name: catalog.name }} onChanged={refresh} />
      </div>

      {/* Home catalog banner */}
      {catalog.isHome && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef9c3', border: '1px solid #fde047', color: '#713f12', fontSize: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🏠</span>
          <span><strong>Home feed catalog.</strong> Products here pin to the top of the consumer landing feed before the organic creative stream.</span>
        </div>
      )}

      {/* Feed-control toggles — only persisted catalogs have a row to write to */}
      {persisted && (
      <div style={{ display: 'flex', gap: 12, padding: '0 0 16px', flexWrap: 'wrap' }}>
        {([
          { key: 'filterGender'       as const, label: 'Gender filter',        desc: "Hide products whose gender tag mismatches the shopper's profile" },
          { key: 'filterAge'          as const, label: 'Age filter',            desc: 'Hide age_group-mismatched products (run tag-product-age-groups.mjs first)', disabled: true },
          { key: 'boostTopConverting' as const, label: 'Top-converting first', desc: 'Sort pinned block by conversion_score desc' },
        ]).map(t => {
          const on = !!((catalog as unknown as Record<string, unknown>)[t.key]);
          return (
            <div
              key={t.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                borderRadius: 8, border: `1px solid ${on ? '#111' : '#e5e7eb'}`,
                background: on ? '#f8fafc' : '#fff', opacity: t.disabled ? 0.5 : 1,
              }}
            >
              <button
                role="switch"
                aria-checked={on}
                disabled={t.disabled}
                onClick={async () => {
                  if (t.disabled) return;
                  const next = !on;
                  setCatalog(prev => prev ? { ...prev, [t.key]: next } : prev);
                  await updateCatalogToggles(catalog.slug, { [t.key]: next });
                }}
                title={t.disabled ? 'Run scripts/tag-product-age-groups.mjs first' : undefined}
                style={{
                  width: 36, height: 20, borderRadius: 10, border: 'none',
                  background: on ? '#111' : '#d1d5db', position: 'relative',
                  cursor: t.disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
                  transition: 'background 0.15s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: on ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.15s',
                }} />
              </button>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{t.label}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{t.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Search activity */}
      {searchCounts && (
        <div style={{ display: 'flex', gap: 12, padding: '0 0 16px', flexWrap: 'wrap' }}>
          {([
            { label: 'Searches 24h',   value: searchCounts.count24h },
            { label: 'Searches 7d',    value: searchCounts.count7d },
            { label: 'Searches total', value: searchCounts.countTotal },
          ] as const).map(s => (
            <div key={s.label} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', minWidth: 100, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{s.value.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Looks / products / creatives / feed search — identical to the
          inline dropdown on the catalogs table. */}
      <div className="admin-table-wrap" style={{ paddingTop: 4 }}>
        <CatalogCreativeDropdown
          isAll={isAll}
          isUniverse={isUniverse}
          catalogName={catalog.name}
          loading={loading}
          creative={creative}
          metricsLoading={false}
          catalogNames={catalogNames}
          onReorder={() => {}}
          onAfterBulkMutation={refresh}
        />
      </div>
    </div>
  );
}

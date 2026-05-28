import { useState, useEffect, useCallback } from 'react';
import { supabase } from '~/utils/supabase';
import {
  AddProductsModal,
  AddLooksModal,
  SuggestProductsModal,
  AssembleLookModal,
  type Catalog,
  type ProductRow,
  type LookRow,
} from '~/routes/admin/catalogs';

interface CatalogActionBarProps {
  /** The catalog these actions operate on. Only id + name are needed. */
  catalog: { id: string; name: string };
  /** Fired after any mutation (tag add / suggest ingest / look save) so the
   *  parent can refresh its view. */
  onChanged?: () => void;
}

// Mirrors the inline action buttons on the admin catalogs table row
// (+ Add Products, + Add Looks, Suggest Products, ✨ Assemble Look) so the
// dedicated catalog detail page exposes the same tools. Self-contained:
// loads its own product/look libraries and owns its modal state.
export default function CatalogActionBar({ catalog, onChanged }: CatalogActionBarProps) {
  // Shape the minimal local catalog the modals expect.
  const modalCatalog: Catalog = { id: catalog.id, name: catalog.name, source: 'custom', createdAt: ' - ' };

  // Libraries for the "pick from existing" modals.
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [looks, setLooks] = useState<LookRow[]>([]);

  const loadProducts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('products').select('id, name, brand, image_url, catalog_tags');
    if (data) setProducts(data as ProductRow[]);
  }, []);

  const loadLooks = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('looks')
      .select(`id, legacy_id, title, creator_handle, catalog_tags, looks_creative ( video_url, is_primary )`)
      .eq('status', 'live')
      .eq('enabled', true)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (!data) return;
    type LookPayload = {
      id: string;
      legacy_id: number | null;
      title: string | null;
      creator_handle: string | null;
      catalog_tags: string[] | null;
      looks_creative: { video_url: string | null; is_primary: boolean }[] | null;
    };
    setLooks((data as LookPayload[]).map(r => ({
      id: r.id,
      legacyId: r.legacy_id,
      title: r.title,
      creatorHandle: r.creator_handle,
      videoPath: r.looks_creative?.find(c => c.is_primary)?.video_url ?? r.looks_creative?.[0]?.video_url ?? null,
      catalog_tags: Array.isArray(r.catalog_tags) ? r.catalog_tags : [],
    })));
  }, []);

  useEffect(() => { loadProducts(); loadLooks(); }, [loadProducts, loadLooks]);

  // Local toast.
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const afterMutation = useCallback(() => {
    loadProducts();
    loadLooks();
    onChanged?.();
  }, [loadProducts, loadLooks, onChanged]);

  // Which modal is open.
  const [addOpen, setAddOpen] = useState(false);
  const [addLooksOpen, setAddLooksOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [assembleOpen, setAssembleOpen] = useState(false);

  // ── Add Products state + handlers ──────────────────────────────────
  const [addSearch, setAddSearch] = useState('');
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addBusy, setAddBusy] = useState(false);
  const [addAutoPicking, setAddAutoPicking] = useState(false);
  const [addAutoProgress, setAddAutoProgress] = useState<{ done: number; total: number } | null>(null);

  const openAdd = useCallback(() => { setAddSearch(''); setAddSelected(new Set()); setAddOpen(true); }, []);
  const closeAdd = useCallback(() => { if (addBusy) return; setAddOpen(false); setAddSearch(''); setAddSelected(new Set()); }, [addBusy]);
  const toggleAddSelected = useCallback((id: string) => {
    setAddSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const autoPickRelevant = useCallback(async () => {
    if (!supabase) return;
    const name = catalog.name;
    const candidates = products.filter(p => !(p.catalog_tags || []).includes(name));
    if (candidates.length === 0) { showToast('Every product in the library is already in this catalog.'); return; }
    setAddAutoPicking(true);
    setAddAutoProgress({ done: 0, total: candidates.length });
    try {
      const BATCH = 30;
      const CONCURRENCY = 6;
      const batches: ProductRow[][] = [];
      for (let i = 0; i < candidates.length; i += BATCH) batches.push(candidates.slice(i, i + BATCH));

      const picked = new Set<string>();
      let firstError: string | null = null;
      let completed = 0;
      let nextBatch = 0;

      // Worker pool: run up to CONCURRENCY batches in parallel instead of
      // awaiting each one sequentially. This is the main speedup — wall time
      // drops from (numBatches × Claude latency) to roughly that divided by
      // CONCURRENCY. Stop scheduling new work once a batch errors.
      const worker = async () => {
        while (nextBatch < batches.length && !firstError) {
          const batch = batches[nextBatch++];
          const { data, error } = await supabase!.functions.invoke('catalog-auto-tag', {
            body: { products: batch.map(p => ({ id: p.id, name: p.name || '', brand: p.brand || '', image_url: p.image_url })), catalogs: [name] },
          });
          if (error) { if (!firstError) firstError = error.message; break; }
          if (data?.success && data.results) {
            const results = data.results as Record<string, string[]>;
            for (const [id, tags] of Object.entries(results)) { if (tags.includes(name)) picked.add(id); }
          }
          completed += batch.length;
          setAddAutoProgress({ done: Math.min(completed, candidates.length), total: candidates.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

      setAddSelected(prev => { const next = new Set(prev); picked.forEach(id => next.add(id)); return next; });
      if (firstError) {
        showToast(`Auto-pick partially failed: ${firstError}. Picked ${picked.size} so far.`);
      } else {
        showToast(`Picked ${picked.size} relevant product${picked.size === 1 ? '' : 's'}. Review and click Add to commit.`);
      }
    } catch (err) {
      showToast(`Auto-pick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddAutoPicking(false);
      setAddAutoProgress(null);
    }
  }, [catalog.name, products, showToast]);

  const commitAdd = useCallback(async () => {
    if (!supabase || addSelected.size === 0) return;
    setAddBusy(true);
    try {
      const name = catalog.name;
      const updates = Array.from(addSelected).map(id => {
        const p = products.find(x => x.id === id);
        const tags = new Set([...(p?.catalog_tags || []), name]);
        return supabase!.from('products').update({ catalog_tags: Array.from(tags) }).eq('id', id).select('id');
      });
      const results = await Promise.all(updates);
      const errored = results.filter(r => r.error);
      const blocked = results.filter(r => !r.error && (!r.data || r.data.length === 0));
      const succeeded = results.length - errored.length - blocked.length;
      if (succeeded === 0) {
        showToast(errored.length > 0 ? `Update failed: ${errored[0].error?.message || 'unknown error'}` : 'No products were written - check RLS policies on public.products.');
      } else if (succeeded < results.length) {
        showToast(`Added ${succeeded} of ${results.length} products to ${name} (${results.length - succeeded} blocked).`);
      } else {
        showToast(`Added ${succeeded} product${succeeded === 1 ? '' : 's'} to ${name}.`);
      }
      if (succeeded > 0) {
        setAddOpen(false);
        setAddSelected(new Set());
        setAddSearch('');
        afterMutation();
      }
    } finally {
      setAddBusy(false);
    }
  }, [catalog.name, addSelected, products, showToast, afterMutation]);

  // ── Add Looks state + handlers ─────────────────────────────────────
  const [addLooksSearch, setAddLooksSearch] = useState('');
  const [addLooksSelected, setAddLooksSelected] = useState<Set<string>>(new Set());
  const [addLooksBusy, setAddLooksBusy] = useState(false);

  const openAddLooks = useCallback(() => { setAddLooksSearch(''); setAddLooksSelected(new Set()); setAddLooksOpen(true); }, []);
  const closeAddLooks = useCallback(() => { if (addLooksBusy) return; setAddLooksOpen(false); setAddLooksSearch(''); setAddLooksSelected(new Set()); }, [addLooksBusy]);
  const toggleAddLookSelected = useCallback((id: string) => {
    setAddLooksSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const commitAddLooks = useCallback(async () => {
    if (!supabase || addLooksSelected.size === 0) return;
    setAddLooksBusy(true);
    try {
      const name = catalog.name;
      const updates = Array.from(addLooksSelected).map(id => {
        const l = looks.find(x => x.id === id);
        const tags = new Set([...(l?.catalog_tags || []), name]);
        return supabase!.from('looks').update({ catalog_tags: Array.from(tags) }).eq('id', id).select('id');
      });
      const results = await Promise.all(updates);
      const errored = results.filter(r => r.error);
      const blocked = results.filter(r => !r.error && (!r.data || r.data.length === 0));
      const succeeded = results.length - errored.length - blocked.length;
      if (succeeded === 0) {
        showToast(errored.length > 0 ? `Update failed: ${errored[0].error?.message || 'unknown error'}` : 'No looks were written - check RLS policies on public.looks.');
      } else if (succeeded < results.length) {
        showToast(`Added ${succeeded} of ${results.length} looks to ${name} (${results.length - succeeded} blocked).`);
      } else {
        showToast(`Added ${succeeded} look${succeeded === 1 ? '' : 's'} to ${name}.`);
      }
      if (succeeded > 0) {
        setAddLooksOpen(false);
        setAddLooksSelected(new Set());
        setAddLooksSearch('');
        afterMutation();
      }
    } finally {
      setAddLooksBusy(false);
    }
  }, [catalog.name, addLooksSelected, looks, showToast, afterMutation]);

  const taggedProductCount = products.filter(p => (p.catalog_tags || []).includes(catalog.name)).length;

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={openAdd}
          disabled={products.length === 0}
          title="Pick existing products from the library and tag them to this catalog"
        >
          + Add Products
        </button>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={openAddLooks}
          disabled={looks.length === 0}
          title="Pick existing looks from the library and tag them to this catalog"
        >
          + Add Looks
        </button>
        <button className="admin-btn admin-btn-primary" onClick={() => setSuggestOpen(true)}>
          Suggest Products
        </button>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={() => setAssembleOpen(true)}
          disabled={taggedProductCount < 3}
          title={taggedProductCount < 3 ? 'Tag at least 3 products with this catalog first' : 'Claude assembles a look from tagged products'}
        >
          ✨ Assemble Look
        </button>
      </div>

      {addOpen && (
        <AddProductsModal
          catalog={modalCatalog}
          products={products}
          search={addSearch}
          onSearch={setAddSearch}
          selected={addSelected}
          onToggle={toggleAddSelected}
          busy={addBusy}
          autoPicking={addAutoPicking}
          autoProgress={addAutoProgress}
          onAutoPick={autoPickRelevant}
          onClose={closeAdd}
          onCommit={commitAdd}
        />
      )}

      {addLooksOpen && (
        <AddLooksModal
          catalog={modalCatalog}
          looks={looks}
          search={addLooksSearch}
          onSearch={setAddLooksSearch}
          selected={addLooksSelected}
          onToggle={toggleAddLookSelected}
          busy={addLooksBusy}
          onClose={closeAddLooks}
          onCommit={commitAddLooks}
        />
      )}

      {suggestOpen && (
        <SuggestProductsModal
          catalog={modalCatalog}
          onClose={() => setSuggestOpen(false)}
          onIngested={afterMutation}
          showToast={showToast}
        />
      )}

      {assembleOpen && (
        <AssembleLookModal
          catalog={modalCatalog}
          products={products}
          onClose={() => setAssembleOpen(false)}
          onSaved={afterMutation}
          showToast={showToast}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#111', color: '#fff', padding: '10px 20px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {toast}
        </div>
      )}
    </>
  );
}

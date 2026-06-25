import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Collection { id: string; name: string | null; slug: string | null }
interface ProductLite { id: string; name: string | null; image_url: string | null }
interface CollProduct { sort_order: number | null; products: ProductLite | null }

const kebab = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export default function PartnersCollections() {
  const { brand, role } = usePartnersContext();
  const canEdit = role === 'owner' || role === 'admin';

  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadCollections() {
    if (!supabase) return;
    const { data } = await supabase
      .from('brand_collections')
      .select('id, name, slug')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: false });
    setCollections((data ?? []) as Collection[]);
  }

  useEffect(() => { loadCollections(); /* eslint-disable-next-line */ }, [brand.id]);

  async function createCollection() {
    if (!supabase || !canEdit) return;
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    await supabase.from('brand_collections').insert({ brand_id: brand.id, name, slug: kebab(name) });
    setNewName('');
    setBusy(false);
    await loadCollections();
  }

  async function deleteCollection(id: string) {
    if (!supabase || !canEdit) return;
    if (!confirm('Delete this collection? Products are not deleted.')) return;
    await supabase.from('brand_collections').delete().eq('id', id).eq('brand_id', brand.id);
    if (openId === id) setOpenId(null);
    await loadCollections();
  }

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Collections</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 18px' }}>
        Group {brand.name}’s products into curated sets.
      </p>

      {canEdit && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createCollection(); }}
            placeholder="New collection name"
            disabled={busy}
            style={{ ...inp, maxWidth: 320 }}
          />
          <button onClick={createCollection} disabled={busy || !newName.trim()} style={btn(busy || !newName.trim())}>
            {busy ? 'Adding…' : 'New collection'}
          </button>
        </div>
      )}

      {collections === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : collections.length === 0 ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No collections yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {canEdit ? 'Create one above to start grouping products.' : 'No collections have been created.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {collections.map(c => (
            <CollectionRow
              key={c.id}
              collection={c}
              brandId={brand.id}
              canEdit={canEdit}
              open={openId === c.id}
              onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              onDelete={() => deleteCollection(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionRow({
  collection, brandId, canEdit, open, onToggle, onDelete,
}: {
  collection: Collection; brandId: string; canEdit: boolean;
  open: boolean; onToggle: () => void; onDelete: () => void;
}) {
  const [items, setItems] = useState<CollProduct[] | null>(null);
  const [picker, setPicker] = useState<ProductLite[] | null>(null); // products NOT in collection
  const [showPicker, setShowPicker] = useState(false);

  async function loadItems() {
    if (!supabase) return;
    const { data } = await supabase
      .from('brand_collection_products')
      .select('sort_order, products(id, name, image_url)')
      .eq('collection_id', collection.id)
      .order('sort_order', { ascending: true });
    setItems((data ?? []) as any as CollProduct[]);
  }

  useEffect(() => { if (open) loadItems(); /* eslint-disable-next-line */ }, [open]);

  async function loadPicker() {
    if (!supabase) return;
    const { data } = await supabase
      .from('products')
      .select('id, name, image_url')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(500);
    const inSet = new Set((items ?? []).map(i => i.products?.id).filter(Boolean) as string[]);
    setPicker(((data ?? []) as ProductLite[]).filter(p => !inSet.has(p.id)));
  }

  async function addProduct(productId: string) {
    if (!supabase) return;
    const nextOrder = (items ?? []).length;
    await supabase.from('brand_collection_products').insert({
      collection_id: collection.id, product_id: productId, sort_order: nextOrder,
    });
    await loadItems();
    setShowPicker(false);
    setPicker(null);
  }

  async function removeProduct(productId: string) {
    if (!supabase) return;
    await supabase.from('brand_collection_products')
      .delete().eq('collection_id', collection.id).eq('product_id', productId);
    await loadItems();
  }

  return (
    <div style={{ border: '1px solid #ececef', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer' }} onClick={onToggle}>
        <span style={{ width: 16, color: '#8b8b93', fontSize: 12 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{collection.name || 'Untitled'}</span>
        {collection.slug && <span style={{ color: '#8b8b93', marginLeft: 8, fontSize: 12 }}>/{collection.slug}</span>}
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            style={{ border: '1px solid #ececef', background: '#fff', color: '#c0392b', borderRadius: 9, fontSize: 12, fontWeight: 600, padding: '5px 11px', cursor: 'pointer' }}
          >
            Delete
          </button>
        )}
      </div>

      {open && (
        <div style={{ borderTop: '1px solid #f0f0f2', padding: 16 }}>
          {items === null ? (
            <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ fontSize: 13, color: '#8b8b93' }}>No products in this collection yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map(it => it.products && (
                <div key={it.products.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {it.products.image_url
                    ? <img src={it.products.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', background: '#f0f0f2' }} />
                    : <span style={{ width: 32, height: 32, borderRadius: 6, background: '#f0f0f2', display: 'inline-block' }} />}
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{it.products.name || 'Untitled'}</span>
                  {canEdit && (
                    <button
                      onClick={() => removeProduct(it.products!.id)}
                      style={{ border: '1px solid #ececef', background: '#fff', color: '#8b8b93', borderRadius: 9, fontSize: 12, fontWeight: 600, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div style={{ marginTop: 14 }}>
              {!showPicker ? (
                <button onClick={() => { setShowPicker(true); loadPicker(); }} style={btn(false)}>Add product</button>
              ) : (
                <div style={{ border: '1px solid #ececef', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#6b6b73', flex: 1 }}>Add a product</span>
                    <button
                      onClick={() => { setShowPicker(false); setPicker(null); }}
                      style={{ border: 'none', background: 'none', color: '#8b8b93', fontSize: 12, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                  {picker === null ? (
                    <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
                  ) : picker.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#8b8b93' }}>All your products are already in this collection.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                      {picker.map(p => (
                        <button
                          key={p.id}
                          onClick={() => addProduct(p.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #f0f0f2', background: '#fff', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', textAlign: 'left' }}
                        >
                          {p.image_url
                            ? <img src={p.image_url} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', background: '#f0f0f2' }} />
                            : <span style={{ width: 28, height: 28, borderRadius: 6, background: '#f0f0f2', display: 'inline-block' }} />}
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name || 'Untitled'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  display: 'block', width: '100%', padding: '9px 11px', borderRadius: 9,
  border: '1px solid #e2e2e6', fontSize: 13, fontFamily: 'inherit', color: '#1a1a1f', background: '#fff',
};

const btn = (disabled: boolean): React.CSSProperties => ({
  padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600,
  cursor: disabled ? 'default' : 'pointer', background: disabled ? '#ececef' : '#111', color: disabled ? '#9a9aa2' : '#fff',
});

import { useEffect, useState } from 'react';
import { Link, useParams } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface ProductForm { name: string; price: string; url: string; image_url: string; description: string }

export default function PartnersProductEdit() {
  const { brand, role } = usePartnersContext();
  const { id } = useParams();
  const canEdit = role === 'owner' || role === 'admin';
  const [form, setForm] = useState<ProductForm | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id,name,price,description,url,image_url')
        .eq('id', id)
        .eq('brand_id', brand.id)
        .single();
      if (cancelled) return;
      if (!data) { setNotFound(true); return; }
      const r = data as any;
      setForm({
        name: r.name ?? '', price: r.price ?? '', url: r.url ?? '',
        image_url: r.image_url ?? '', description: r.description ?? '',
      });
    })();
    return () => { cancelled = true; };
  }, [brand.id, id]);

  async function save() {
    if (!supabase || !form || !id) return;
    setErr(null); setMsg(null); setBusy(true);
    const { error } = await supabase.from('products').update({
      name: form.name.trim() || null,
      price: form.price.trim() || null,
      url: form.url.trim() || null,
      image_url: form.image_url.trim() || null,
      description: form.description.trim() || null,
    }).eq('id', id).eq('brand_id', brand.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMsg('Saved.');
  }

  const set = (k: keyof ProductForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => f ? { ...f, [k]: e.target.value } : f);

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <Link to="/partners/products" style={{ fontSize: 12, color: '#8b8b93' }}>← Back to products</Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0 4px' }}>Edit product</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 20px' }}>
        {canEdit ? 'Update the details for this product.' : 'Only a brand owner or admin can edit products.'}
      </p>

      {notFound ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>Product not found</div>
          <div style={{ fontSize: 13, marginTop: 6 }}><Link to="/partners/products">Back to products</Link></div>
        </div>
      ) : !form ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : (
        <div style={{ padding: 20, borderRadius: 14, border: '1px solid #ececef', background: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Name">
            <input value={form.name} onChange={set('name')} disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Price">
            <input value={form.price} onChange={set('price')} placeholder="$0.00" disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Product URL">
            <input value={form.url} onChange={set('url')} placeholder="https://…" disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Image URL">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {form.image_url
                ? <img src={form.image_url} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', border: '1px solid #eee' }} />
                : <span style={{ width: 48, height: 48, borderRadius: 8, background: '#f0f0f2' }} />}
              <input value={form.image_url} onChange={set('image_url')} placeholder="https://…" disabled={!canEdit || busy} style={{ ...inp, flex: 1 }} />
            </div>
          </Field>
          <Field label="Description">
            <textarea value={form.description} onChange={set('description')} rows={4} disabled={!canEdit || busy} style={{ ...inp, resize: 'vertical' }} />
          </Field>

          {canEdit && (
            <div>
              <button onClick={save} disabled={busy}
                style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', background: busy ? '#ececef' : '#111', color: busy ? '#9a9aa2' : '#fff' }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              {msg && <span style={{ fontSize: 12, color: '#188a4a', marginLeft: 12 }}>{msg}</span>}
              {err && <span style={{ fontSize: 12, color: '#c0392b', marginLeft: 12 }}>{err}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: '#6b6b73' }}>
      {label}
      <div style={{ marginTop: 6 }}>{children}</div>
    </label>
  );
}

const inp: React.CSSProperties = {
  display: 'block', width: '100%', padding: '9px 11px', borderRadius: 9,
  border: '1px solid #e2e2e6', fontSize: 13, fontFamily: 'inherit', color: '#1a1a1f', background: '#fff',
};

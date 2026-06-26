import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Ad {
  id: string;
  name: string | null;
  media_url: string | null;
  media_type: 'image' | 'video' | null;
  heading: string | null;
  cta: string | null;
  orientation: 'portrait' | 'landscape' | null;
  status: 'draft' | 'active' | 'paused' | null;
  created_at: string | null;
}

const STATUS_NEXT: Record<string, Ad['status']> = { draft: 'active', active: 'paused', paused: 'draft' };
const STATUS_COLOR: Record<string, string> = { draft: '#9a6b00', active: '#188a4a', paused: '#8b8b93' };

const emptyForm = {
  name: '', media_url: '', media_type: 'image' as 'image' | 'video',
  heading: '', cta: 'Shop Now', orientation: 'portrait' as 'portrait' | 'landscape',
};

export default function PartnersAds() {
  const { brand, role } = usePartnersContext();
  const canEdit = role === 'owner' || role === 'admin';
  const [rows, setRows] = useState<Ad[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('brand_advertisements')
        .select('id, name, media_url, media_type, heading, cta, orientation, status, created_at')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false });
      if (!cancelled) setRows((data ?? []) as Ad[]);
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  async function create() {
    if (!supabase || !form.name.trim() || !form.media_url.trim()) { setErr('Name and media URL are required.'); return; }
    setErr(null); setBusy(true);
    const { data, error } = await supabase.from('brand_advertisements').insert({
      brand_id: brand.id,
      name: form.name.trim(),
      media_url: form.media_url.trim(),
      media_type: form.media_type,
      heading: form.heading.trim() || null,
      cta: form.cta.trim() || null,
      orientation: form.orientation,
      status: 'draft',
    }).select('id, name, media_url, media_type, heading, cta, orientation, status, created_at').single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setRows(r => [data as Ad, ...(r ?? [])]);
    setForm(emptyForm); setCreating(false);
  }

  async function cycleStatus(ad: Ad) {
    if (!supabase) return;
    const next = STATUS_NEXT[ad.status || 'draft'];
    const { error } = await supabase.from('brand_advertisements').update({ status: next }).eq('id', ad.id).eq('brand_id', brand.id);
    if (!error) setRows(r => (r ?? []).map(x => x.id === ad.id ? { ...x, status: next } : x));
  }

  async function remove(ad: Ad) {
    if (!supabase || !window.confirm(`Delete "${ad.name || 'this ad'}"?`)) return;
    const { error } = await supabase.from('brand_advertisements').delete().eq('id', ad.id).eq('brand_id', brand.id);
    if (!error) setRows(r => (r ?? []).filter(x => x.id !== ad.id));
  }

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Advertisements</h1>
          <p style={{ fontSize: 13, color: '#8b8b93', margin: 0 }}>
            {canEdit ? 'Creatives that power your campaigns.' : 'Your brand’s advertisement creatives.'}
          </p>
        </div>
        {canEdit && !creating && (
          <button onClick={() => { setErr(null); setCreating(true); }}
            style={{ padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#111', color: '#fff', whiteSpace: 'nowrap' }}>
            New ad
          </button>
        )}
      </div>

      {canEdit && creating && (
        <div style={{ marginTop: 18, padding: 20, borderRadius: 14, border: '1px solid #ececef', background: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Name (for your reference)">
            <input value={form.name} onChange={set('name')} placeholder="Spring sale hero" disabled={busy} style={inp} />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Media URL" style={{ flex: 1 }}>
              <input value={form.media_url} onChange={set('media_url')} placeholder="https://…" disabled={busy} style={inp} />
            </Field>
            <Field label="Media type">
              <select value={form.media_type} onChange={set('media_type')} disabled={busy} style={inp}>
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Heading" style={{ flex: 1 }}>
              <input value={form.heading} onChange={set('heading')} placeholder={brand.name} disabled={busy} style={inp} />
            </Field>
            <Field label="Call to action" style={{ flex: 1 }}>
              <input value={form.cta} onChange={set('cta')} placeholder="Shop Now" disabled={busy} style={inp} />
            </Field>
            <Field label="Orientation">
              <select value={form.orientation} onChange={set('orientation')} disabled={busy} style={inp}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </Field>
          </div>
          <div>
            <button onClick={create} disabled={busy}
              style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', background: busy ? '#ececef' : '#111', color: busy ? '#9a9aa2' : '#fff' }}>
              {busy ? 'Creating…' : 'Create ad'}
            </button>
            <button onClick={() => { setCreating(false); setForm(emptyForm); setErr(null); }} disabled={busy}
              style={{ marginLeft: 10, padding: '9px 18px', borderRadius: 9, border: '1px solid #e2e2e6', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#444' }}>
              Cancel
            </button>
            {err && <span style={{ fontSize: 12, color: '#c0392b', marginLeft: 12 }}>{err}</span>}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {rows === null ? (
          <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No advertisements yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {canEdit ? 'Click “New ad” to create your first creative.' : 'No ad creatives have been created yet.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {rows.map(ad => (
              <div key={ad.id} style={{ border: '1px solid #ececef', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
                <div style={{ aspectRatio: ad.orientation === 'landscape' ? '16 / 9' : '3 / 4', background: '#f0f0f2', position: 'relative' }}>
                  {ad.media_url ? (
                    ad.media_type === 'video'
                      ? <video src={ad.media_url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <img src={ad.media_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                  <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', borderRadius: 999, background: '#fff', color: STATUS_COLOR[ad.status || 'draft'], fontWeight: 700, fontSize: 11, textTransform: 'capitalize' }}>
                    {ad.status || 'draft'}
                  </span>
                </div>
                <div style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{ad.name || 'Untitled'}</div>
                  {ad.heading && <div style={{ fontSize: 12, color: '#444', marginTop: 2 }}>{ad.heading}</div>}
                  <div style={{ fontSize: 12, color: '#8b8b93', marginTop: 4 }}>
                    {ad.cta || 'Shop Now'} · {ad.orientation || 'portrait'}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => cycleStatus(ad)}
                        style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid #e2e2e6', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#444' }}>
                        → {STATUS_NEXT[ad.status || 'draft']}
                      </button>
                      <button onClick={() => remove(ad)}
                        style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #f0d4d0', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#c0392b' }}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: '#6b6b73', ...style }}>
      {label}
      <div style={{ marginTop: 6 }}>{children}</div>
    </label>
  );
}

const inp: React.CSSProperties = {
  display: 'block', width: '100%', padding: '9px 11px', borderRadius: 9,
  border: '1px solid #e2e2e6', fontSize: 13, fontFamily: 'inherit', color: '#1a1a1f', background: '#fff',
};

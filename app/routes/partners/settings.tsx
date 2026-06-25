import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface BrandProfile { name: string; logo_url: string; website: string; description: string }

export default function PartnersSettings() {
  const { brand, role } = usePartnersContext();
  const canEdit = role === 'owner' || role === 'admin';
  const [form, setForm] = useState<BrandProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('brands').select('name, logo_url, website, description').eq('id', brand.id).single();
      if (cancelled) return;
      setForm({
        name: data?.name ?? '', logo_url: data?.logo_url ?? '',
        website: data?.website ?? '', description: data?.description ?? '',
      });
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  async function save() {
    if (!supabase || !form) return;
    setErr(null); setMsg(null); setBusy(true);
    const { error } = await supabase.from('brands').update({
      name: form.name.trim() || brand.name,
      logo_url: form.logo_url.trim() || null,
      website: form.website.trim() || null,
      description: form.description.trim() || null,
    }).eq('id', brand.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMsg('Saved. Changes show across the portal on your next reload.');
  }

  const set = (k: keyof BrandProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => f ? { ...f, [k]: e.target.value } : f);

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Brand profile</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 20px' }}>
        {canEdit ? 'Your brand’s public information.' : 'Only a brand owner or admin can edit these.'}
      </p>

      {!form ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : (
        <div style={{ padding: 20, borderRadius: 14, border: '1px solid #ececef', background: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Brand name">
            <input value={form.name} onChange={set('name')} disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Logo URL">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {form.logo_url
                ? <img src={form.logo_url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', border: '1px solid #eee' }} />
                : <span style={{ width: 40, height: 40, borderRadius: 8, background: '#f0f0f2' }} />}
              <input value={form.logo_url} onChange={set('logo_url')} placeholder="https://…" disabled={!canEdit || busy} style={{ ...inp, flex: 1 }} />
            </div>
          </Field>
          <Field label="Website">
            <input value={form.website} onChange={set('website')} placeholder="https://yourbrand.com" disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Description">
            <textarea value={form.description} onChange={set('description')} rows={3} disabled={!canEdit || busy} style={{ ...inp, resize: 'vertical' }} />
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

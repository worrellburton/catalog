import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface CompanyForm {
  name: string;
  company_legal_name: string;
  company_email: string;
  company_phone: string;
  company_address: string;
}

export default function PartnersCompany() {
  const { brand, role } = usePartnersContext();
  const canEdit = role === 'owner' || role === 'admin';
  const [form, setForm] = useState<CompanyForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('brands')
        .select('name, company_legal_name, company_email, company_phone, company_address')
        .eq('id', brand.id)
        .single();
      if (cancelled) return;
      const r = data as any;
      setForm({
        name: r?.name ?? '',
        company_legal_name: r?.company_legal_name ?? '',
        company_email: r?.company_email ?? '',
        company_phone: r?.company_phone ?? '',
        company_address: r?.company_address ?? '',
      });
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  async function save() {
    if (!supabase || !form) return;
    setErr(null); setMsg(null); setBusy(true);
    const { error } = await supabase.from('brands').update({
      name: form.name.trim() || brand.name,
      company_legal_name: form.company_legal_name.trim() || null,
      company_email: form.company_email.trim() || null,
      company_phone: form.company_phone.trim() || null,
      company_address: form.company_address.trim() || null,
    }).eq('id', brand.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMsg('Saved. Changes show across the portal on your next reload.');
  }

  const set = (k: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => f ? { ...f, [k]: e.target.value } : f);

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Company</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 20px' }}>
        {canEdit ? 'Legal and contact details for your company.' : 'Only a brand owner or admin can edit these.'}
      </p>

      {!form ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : (
        <div style={{ maxWidth: 640, padding: 20, borderRadius: 14, border: '1px solid #ececef', background: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Brand name">
            <input value={form.name} onChange={set('name')} disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Legal company name">
            <input value={form.company_legal_name} onChange={set('company_legal_name')} placeholder="Acme Inc." disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Company email">
            <input value={form.company_email} onChange={set('company_email')} type="email" placeholder="billing@yourbrand.com" disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Company phone">
            <input value={form.company_phone} onChange={set('company_phone')} placeholder="+1 555 000 0000" disabled={!canEdit || busy} style={inp} />
          </Field>
          <Field label="Company address">
            <textarea value={form.company_address} onChange={set('company_address')} rows={3} placeholder="Street, City, State, ZIP, Country" disabled={!canEdit || busy} style={{ ...inp, resize: 'vertical' }} />
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

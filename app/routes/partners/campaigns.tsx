import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

const STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
type Status = typeof STATUSES[number];

const STATUS_STYLE: Record<Status, { bg: string; color: string; label: string }> = {
  draft: { bg: '#f0f0f2', color: '#6b6b73', label: 'Draft' },
  active: { bg: '#e3f5ea', color: '#188a4a', label: 'Active' },
  paused: { bg: '#fff3da', color: '#9a6b00', label: 'Paused' },
  ended: { bg: '#fbe5e2', color: '#c0392b', label: 'Ended' },
};

export default function PartnersCampaigns() {
  const { brand, role } = usePartnersContext();
  const canEdit = role === 'owner' || role === 'admin';
  const [rows, setRows] = useState<any[] | null>(null);
  const [ads, setAds] = useState<any[]>([]);
  const [audiences, setAudiences] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', advertisement_id: '', audience_id: '',
    destination_url: '', daily_budget: '', starts_at: '', ends_at: '',
  });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [c, a, au] = await Promise.all([
        supabase.from('brand_campaigns')
          .select('id, name, status, destination_url, daily_budget, starts_at, ends_at, advertisement:brand_advertisements(name), audience:brand_audiences(name)')
          .eq('brand_id', brand.id).order('created_at', { ascending: false }),
        supabase.from('brand_advertisements').select('id, name').eq('brand_id', brand.id).order('created_at', { ascending: false }),
        supabase.from('brand_audiences').select('id, name').eq('brand_id', brand.id).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setRows((c.data ?? []) as any[]);
      setAds((a.data ?? []) as any[]);
      setAudiences((au.data ?? []) as any[]);
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  async function create() {
    if (!supabase) return;
    setErr(null);
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    setBusy(true);
    const { data, error } = await supabase.from('brand_campaigns').insert({
      brand_id: brand.id,
      name: form.name.trim(),
      advertisement_id: form.advertisement_id || null,
      audience_id: form.audience_id || null,
      destination_url: form.destination_url.trim() || null,
      daily_budget: form.daily_budget ? Number(form.daily_budget) : null,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
      status: 'draft',
    }).select('id, name, status, destination_url, daily_budget, starts_at, ends_at, advertisement:brand_advertisements(name), audience:brand_audiences(name)').single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setRows(r => [data as any, ...(r ?? [])]);
    setForm({ name: '', advertisement_id: '', audience_id: '', destination_url: '', daily_budget: '', starts_at: '', ends_at: '' });
  }

  async function cycleStatus(row: any) {
    if (!supabase) return;
    const next = STATUSES[(STATUSES.indexOf(row.status) + 1) % STATUSES.length];
    const { error } = await supabase.from('brand_campaigns').update({ status: next }).eq('id', row.id).eq('brand_id', brand.id);
    if (!error) setRows(r => (r ?? []).map(x => x.id === row.id ? { ...x, status: next } : x));
  }

  async function remove(row: any) {
    if (!supabase) return;
    const { error } = await supabase.from('brand_campaigns').delete().eq('id', row.id).eq('brand_id', brand.id);
    if (!error) setRows(r => (r ?? []).filter(x => x.id !== row.id));
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Campaigns</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 18px' }}>
        Run an advertisement against an audience. {canEdit ? 'New campaigns start as a draft.' : 'Only a brand owner or admin can manage campaigns.'}
      </p>

      {canEdit && (
        <div style={{ padding: 18, borderRadius: 14, border: '1px solid #ececef', background: '#fff', marginBottom: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <Field label="Campaign name">
              <input value={form.name} onChange={set('name')} placeholder="Spring launch" disabled={busy} style={inp} />
            </Field>
            <Field label="Destination URL">
              <input value={form.destination_url} onChange={set('destination_url')} placeholder="https://yourbrand.com/spring" disabled={busy} style={inp} />
            </Field>
            <Field label="Advertisement">
              <select value={form.advertisement_id} onChange={set('advertisement_id')} disabled={busy} style={inp}>
                <option value="">— Select an ad —</option>
                {ads.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Audience">
              <select value={form.audience_id} onChange={set('audience_id')} disabled={busy} style={inp}>
                <option value="">— Select an audience —</option>
                {audiences.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Daily budget ($)">
              <input type="number" min={0} step="0.01" value={form.daily_budget} onChange={set('daily_budget')} placeholder="50" disabled={busy} style={inp} />
            </Field>
            <Field label="Starts / ends">
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" value={form.starts_at} onChange={set('starts_at')} disabled={busy} style={{ ...inp, flex: 1 }} />
                <input type="date" value={form.ends_at} onChange={set('ends_at')} disabled={busy} style={{ ...inp, flex: 1 }} />
              </div>
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <button onClick={create} disabled={busy}
              style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', background: busy ? '#ececef' : '#111', color: busy ? '#9a9aa2' : '#fff' }}>
              {busy ? 'Creating…' : 'New campaign'}
            </button>
            {err && <span style={{ fontSize: 12, color: '#c0392b', marginLeft: 12 }}>{err}</span>}
          </div>
        </div>
      )}

      {rows === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No campaigns yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {canEdit ? 'Create your first campaign above.' : 'Campaigns your team creates will appear here.'}
          </div>
        </div>
      ) : (
        <div style={{ border: '1px solid #ececef', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafb', textAlign: 'left', color: '#8b8b93' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Campaign</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Advertisement</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Audience</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Daily budget</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Destination</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Status</th>
                {canEdit && <th style={{ padding: '10px 14px', fontWeight: 600 }} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const st = STATUS_STYLE[(r.status as Status)] ?? STATUS_STYLE.draft;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #f0f0f2' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: '10px 14px', color: r.advertisement?.name ? '#1a1a1f' : '#8b8b93' }}>{r.advertisement?.name || '—'}</td>
                    <td style={{ padding: '10px 14px', color: r.audience?.name ? '#1a1a1f' : '#8b8b93' }}>{r.audience?.name || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>{r.daily_budget != null ? `$${Number(r.daily_budget).toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '10px 14px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.destination_url
                        ? <a href={r.destination_url} target="_blank" rel="noreferrer" style={{ color: '#1f5fd6' }}>{r.destination_url}</a>
                        : <span style={{ color: '#8b8b93' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        onClick={canEdit ? () => cycleStatus(r) : undefined}
                        title={canEdit ? 'Click to change status' : undefined}
                        style={{ padding: '3px 10px', borderRadius: 999, background: st.bg, color: st.color, fontWeight: 600, fontSize: 12, cursor: canEdit ? 'pointer' : 'default', userSelect: 'none' }}>
                        {st.label}
                      </span>
                    </td>
                    {canEdit && (
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <button onClick={() => remove(r)}
                          style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid #ececef', background: '#fff', color: '#c0392b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
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

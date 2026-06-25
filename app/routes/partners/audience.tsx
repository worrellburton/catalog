import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

const GENDERS = ['all', 'male', 'female'] as const;
type Gender = (typeof GENDERS)[number];

export default function PartnersAudience() {
  const { brand, role } = usePartnersContext();
  const canEdit = role === 'owner' || role === 'admin';
  const [rows, setRows] = useState<any[] | null>(null);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('all');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [follows, setFollows] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    const { data } = await supabase
      .from('brand_audiences')
      .select('id, name, gender, age_min, age_max, follows, created_at')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: false });
    setRows((data ?? []) as any[]);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [brand.id]);

  async function create() {
    if (!supabase || !name.trim()) return;
    setErr(null); setBusy(true);
    const handles = follows.split(',').map(h => h.trim().replace(/^@/, '')).filter(Boolean);
    const { error } = await supabase.from('brand_audiences').insert({
      brand_id: brand.id,
      name: name.trim(),
      gender,
      age_min: ageMin ? Number(ageMin) : null,
      age_max: ageMax ? Number(ageMax) : null,
      follows: handles,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setName(''); setGender('all'); setAgeMin(''); setAgeMax(''); setFollows('');
    load();
  }

  async function remove(id: string) {
    if (!supabase) return;
    await supabase.from('brand_audiences').delete().eq('id', id).eq('brand_id', brand.id);
    load();
  }

  const ageLabel = (r: any) =>
    r.age_min && r.age_max ? `${r.age_min}–${r.age_max}` : r.age_min ? `${r.age_min}+` : r.age_max ? `≤${r.age_max}` : 'Any';

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Audiences</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 20px' }}>
        Targeting segments for {brand.name} — by gender, age range, and the creators they follow.
      </p>

      {canEdit && (
        <div style={{ padding: 20, borderRadius: 14, border: '1px solid #ececef', background: '#fff', marginBottom: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>New audience</div>
          <label style={lbl}>
            Name
            <div style={{ marginTop: 6 }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gen-Z streetwear" disabled={busy} style={inp} />
            </div>
          </label>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ ...lbl, flex: '1 1 160px' }}>
              Gender
              <div style={{ marginTop: 6 }}>
                <select value={gender} onChange={e => setGender(e.target.value as Gender)} disabled={busy} style={inp}>
                  {GENDERS.map(g => <option key={g} value={g}>{g === 'all' ? 'All' : g[0].toUpperCase() + g.slice(1)}</option>)}
                </select>
              </div>
            </label>
            <label style={{ ...lbl, flex: '1 1 120px' }}>
              Min age
              <div style={{ marginTop: 6 }}>
                <input type="number" min={0} value={ageMin} onChange={e => setAgeMin(e.target.value)} placeholder="18" disabled={busy} style={inp} />
              </div>
            </label>
            <label style={{ ...lbl, flex: '1 1 120px' }}>
              Max age
              <div style={{ marginTop: 6 }}>
                <input type="number" min={0} value={ageMax} onChange={e => setAgeMax(e.target.value)} placeholder="34" disabled={busy} style={inp} />
              </div>
            </label>
          </div>
          <label style={lbl}>
            Follows creators
            <div style={{ marginTop: 6 }}>
              <input value={follows} onChange={e => setFollows(e.target.value)} placeholder="comma-separated handles, e.g. @alex, jordan" disabled={busy} style={inp} />
            </div>
          </label>
          <div>
            <button onClick={create} disabled={busy || !name.trim()}
              style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600, cursor: busy || !name.trim() ? 'default' : 'pointer', background: busy || !name.trim() ? '#ececef' : '#111', color: busy || !name.trim() ? '#9a9aa2' : '#fff' }}>
              {busy ? 'Creating…' : 'Create audience'}
            </button>
            {err && <span style={{ fontSize: 12, color: '#c0392b', marginLeft: 12 }}>{err}</span>}
          </div>
        </div>
      )}

      {rows === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No audiences yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {canEdit ? 'Create one above to start targeting your campaigns.' : 'A brand owner or admin can create targeting segments.'}
          </div>
        </div>
      ) : (
        <div style={{ border: '1px solid #ececef', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafb', textAlign: 'left', color: '#8b8b93' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Audience</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Gender</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Age</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Follows</th>
                {canEdit && <th style={{ padding: '10px 14px', fontWeight: 600 }} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const count = Array.isArray(r.follows) ? r.follows.length : 0;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #f0f0f2' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: '10px 14px', textTransform: 'capitalize', color: '#8b8b93' }}>{r.gender || 'all'}</td>
                    <td style={{ padding: '10px 14px' }}>{ageLabel(r)}</td>
                    <td style={{ padding: '10px 14px', color: '#8b8b93' }}>{count} creator{count === 1 ? '' : 's'}</td>
                    {canEdit && (
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <button onClick={() => remove(r.id)}
                          style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid #e2e2e6', background: '#fff', fontSize: 12, fontWeight: 600, color: '#c0392b', cursor: 'pointer' }}>
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

const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#6b6b73', display: 'block' };

const inp: React.CSSProperties = {
  display: 'block', width: '100%', padding: '9px 11px', borderRadius: 9,
  border: '1px solid #e2e2e6', fontSize: 13, fontFamily: 'inherit', color: '#1a1a1f', background: '#fff',
};

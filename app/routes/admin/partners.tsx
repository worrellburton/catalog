// /admin/partners — invite & manage brand admins for the partner portal.
// An admin invites by email + brand name; the brand is seeded from our existing
// catalog (matching products + logo). If the email already has an account they're
// added immediately; otherwise a pending invite waits and is auto-accepted when
// that email signs in with Google.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '~/utils/supabase';

interface BrandRow { id: string; slug: string; name: string; logo_url: string | null; created_at: string }
interface Member { brand_id: string; user_id: string; role: string; status: string; email: string | null; full_name: string | null }
interface Invite { id: string; brand_id: string; email: string; role: string; token: string; created_at: string }

const ROLES = ['owner', 'admin', 'finance', 'creative'];

export default function AdminPartners() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [brandName, setBrandName] = useState('');
  const [role, setRole] = useState('owner');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [b, m, i] = await Promise.all([
      supabase.from('brands').select('id, slug, name, logo_url, created_at').order('created_at', { ascending: false }),
      // brand_members has two FKs to profiles (user_id + invited_by) — disambiguate.
      supabase.from('brand_members').select('brand_id, user_id, role, status, profiles!brand_members_user_id_fkey(email, full_name)').neq('status', 'removed'),
      supabase.from('brand_invites').select('id, brand_id, email, role, token, created_at').eq('status', 'pending'),
    ]);
    setBrands((b.data ?? []) as BrandRow[]);
    setMembers((m.data ?? []).map((r: any) => ({
      brand_id: r.brand_id, user_id: r.user_id, role: r.role, status: r.status,
      email: r.profiles?.email ?? null, full_name: r.profiles?.full_name ?? null,
    })));
    setInvites((i.data ?? []) as Invite[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function invite() {
    setError(null); setResult(null);
    if (!supabase) return;
    if (!email.trim() || !brandName.trim()) { setError('Email and brand name are required.'); return; }
    setBusy(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_invite_brand_admin', {
        p_email: email.trim(), p_brand_name: brandName.trim(), p_role: role,
      });
      if (rpcErr) { setError(rpcErr.message); setBusy(false); return; }
      const r = data as { status: string; products_linked: number };
      setResult(r.status === 'active'
        ? `Added — ${email.trim()} already has an account and now has access (${r.products_linked} products linked).`
        : `Invite created. ${email.trim()} gets access automatically when they sign in with Google (${r.products_linked} products linked).`);
      setEmail(''); setBrandName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to invite.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!supabase) return;
    await supabase.from('brand_invites').update({ status: 'revoked' }).eq('id', id);
    await load();
  }
  async function removeMember(brand_id: string, user_id: string) {
    if (!supabase) return;
    await supabase.from('brand_members').update({ status: 'removed' }).eq('brand_id', brand_id).eq('user_id', user_id);
    await load();
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div style={{ padding: 24, maxWidth: 980, color: '#1a1a1f' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Brand Partners</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 20px' }}>
        Invite brand admins to the partner portal. The brand is seeded from our catalog (products + logo).
      </p>

      {/* Invite form */}
      <div style={{ padding: 18, borderRadius: 14, border: '1px solid #ececef', background: '#fff', marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Invite a brand admin</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 220px', fontSize: 12, fontWeight: 600, color: '#6b6b73' }}>
            Email
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="founder@brand.com" disabled={busy}
              style={inp} />
          </label>
          <label style={{ flex: '1 1 200px', fontSize: 12, fontWeight: 600, color: '#6b6b73' }}>
            Brand name
            <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="e.g. Aritzia" disabled={busy}
              style={inp} />
          </label>
          <label style={{ flex: '0 0 130px', fontSize: 12, fontWeight: 600, color: '#6b6b73' }}>
            Role
            <select value={role} onChange={e => setRole(e.target.value)} disabled={busy} style={inp}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button onClick={invite} disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600, height: 38, cursor: busy ? 'default' : 'pointer', background: busy ? '#ececef' : '#111', color: busy ? '#9a9aa2' : '#fff' }}>
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#8b8b93', marginTop: 10, marginBottom: 0 }}>
          Tip: if the brand name matches one already in the catalog, its existing products and logo are linked automatically.
        </p>
        {result && <p style={{ fontSize: 13, color: '#188a4a', marginTop: 10, marginBottom: 0 }}>{result}</p>}
        {error && <p style={{ fontSize: 13, color: '#c0392b', marginTop: 10, marginBottom: 0 }}>{error}</p>}
      </div>

      {/* Brands */}
      {loading ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : brands.length === 0 ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>No brand partners yet. Invite one above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {brands.map(b => {
            const bm = members.filter(m => m.brand_id === b.id);
            const bi = invites.filter(i => i.brand_id === b.id);
            return (
              <div key={b.id} style={{ border: '1px solid #ececef', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #f2f2f4' }}>
                  {b.logo_url
                    ? <img src={b.logo_url} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
                    : <span style={{ width: 32, height: 32, borderRadius: 8, background: '#f0f0f2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{b.name.slice(0, 2).toUpperCase()}</span>}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: '#8b8b93' }}>/{b.slug}</div>
                  </div>
                  <span style={{ fontSize: 12, color: '#8b8b93' }}>{bm.length} member{bm.length === 1 ? '' : 's'}</span>
                </div>

                <div style={{ padding: '8px 16px 14px' }}>
                  {bm.map(m => (
                    <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{m.full_name || m.email || `${m.user_id.slice(0, 8)}…`}</span>
                      <span style={{ fontSize: 12, color: '#8b8b93', textTransform: 'capitalize' }}>{m.role}</span>
                      <button onClick={() => removeMember(m.brand_id, m.user_id)} style={linkBtn}>Remove</button>
                    </div>
                  ))}
                  {bi.map(i => (
                    <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{i.email} <span style={{ fontSize: 11, color: '#9a6b00', background: '#fffaeb', padding: '1px 6px', borderRadius: 999, marginLeft: 6 }}>pending</span></span>
                      <button
                        onClick={() => navigator.clipboard?.writeText(`${origin}/  (sign in with Google as ${i.email})`)}
                        style={linkBtn}>Copy invite link</button>
                      <button onClick={() => revoke(i.id)} style={{ ...linkBtn, color: '#c0392b' }}>Revoke</button>
                    </div>
                  ))}
                  {bm.length === 0 && bi.length === 0 && <div style={{ fontSize: 12, color: '#8b8b93' }}>No members yet.</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 5, padding: '9px 11px',
  borderRadius: 9, border: '1px solid #e2e2e6', fontSize: 13, fontWeight: 400, color: '#1a1a1f', background: '#fff',
};
const linkBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#1f5fd6', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0,
};

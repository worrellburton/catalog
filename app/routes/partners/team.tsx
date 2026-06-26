import { useCallback, useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Member {
  user_id: string;
  role: string;
  status: string;
  profile: { full_name: string | null; email: string | null } | null;
}
interface Invite { id: string; email: string; role: string }

const ROLES = ['owner', 'admin', 'finance', 'creative'];

export default function PartnersTeam() {
  const { brand, role } = usePartnersContext();
  const { user } = useAuth();
  const canManage = role === 'owner' || role === 'admin';

  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('creative');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [m, i] = await Promise.all([
      supabase.from('brand_members')
        .select('user_id, role, status, profiles!brand_members_user_id_fkey ( full_name, email )')
        .eq('brand_id', brand.id).neq('status', 'removed').order('created_at', { ascending: true }),
      supabase.from('brand_invites')
        .select('id, email, role').eq('brand_id', brand.id).eq('status', 'pending'),
    ]);
    setMembers((m.data ?? []).map((r: any) => ({
      user_id: r.user_id, role: r.role, status: r.status, profile: r.profiles ?? null,
    })));
    setInvites((i.data ?? []) as Invite[]);
  }, [brand.id]);

  useEffect(() => { load(); }, [load]);

  async function invite() {
    setErr(null); setMsg(null);
    if (!supabase) return;
    if (!email.trim()) { setErr('Enter an email.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('invite_brand_member', {
      p_brand_id: brand.id, p_email: email.trim(), p_role: inviteRole,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const r = data as { status: string };
    setMsg(r.status === 'active'
      ? `${email.trim()} already has an account and was added.`
      : `Invite sent — ${email.trim()} gets access when they sign in with Google.`);
    setEmail('');
    await load();
  }

  async function removeMember(userId: string) {
    if (!supabase) return;
    await supabase.from('brand_members').update({ status: 'removed' }).eq('brand_id', brand.id).eq('user_id', userId);
    await load();
  }
  async function revokeInvite(id: string) {
    if (!supabase) return;
    await supabase.from('brand_invites').update({ status: 'revoked' }).eq('id', id);
    await load();
  }

  return (
    <div style={{ padding: 24, maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Team</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 18px' }}>People with access to {brand.name}.</p>

      {canManage && (
        <div style={{ padding: 16, borderRadius: 14, border: '1px solid #ececef', background: '#fff', marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Invite a teammate</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@email.com" disabled={busy}
              style={{ flex: '1 1 240px', minWidth: 200, padding: '9px 11px', borderRadius: 9, border: '1px solid #e2e2e6', fontSize: 13 }}
            />
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} disabled={busy}
              style={{ padding: '9px 11px', borderRadius: 9, border: '1px solid #e2e2e6', fontSize: 13, textTransform: 'capitalize' }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button onClick={invite} disabled={busy}
              style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', background: busy ? '#ececef' : '#111', color: busy ? '#9a9aa2' : '#fff' }}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
          {msg && <p style={{ fontSize: 12, color: '#188a4a', marginTop: 10, marginBottom: 0 }}>{msg}</p>}
          {err && <p style={{ fontSize: 12, color: '#c0392b', marginTop: 10, marginBottom: 0 }}>{err}</p>}
        </div>
      )}

      {members === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : (
        <div style={{ border: '1px solid #ececef', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafb', textAlign: 'left', color: '#8b8b93' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Member</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Role</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Status</th>
                {canManage && <th style={{ padding: '10px 14px', fontWeight: 600 }} />}
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.user_id} style={{ borderTop: '1px solid #f0f0f2' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                    {m.profile?.full_name || m.profile?.email || `${m.user_id.slice(0, 8)}…`}
                    {m.user_id === user?.id && <span style={{ fontSize: 11, color: '#8b8b93', fontWeight: 400 }}> (you)</span>}
                  </td>
                  <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>{m.role}</td>
                  <td style={{ padding: '10px 14px', textTransform: 'capitalize', color: '#188a4a' }}>{m.status}</td>
                  {canManage && (
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      {m.user_id !== user?.id && (
                        <button onClick={() => removeMember(m.user_id)}
                          style={{ border: 'none', background: 'transparent', color: '#c0392b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {invites.map(iv => (
                <tr key={iv.id} style={{ borderTop: '1px solid #f0f0f2', background: '#fffdf7' }}>
                  <td style={{ padding: '10px 14px' }}>
                    {iv.email} <span style={{ fontSize: 11, color: '#9a6b00', background: '#fffaeb', padding: '1px 6px', borderRadius: 999, marginLeft: 4 }}>pending</span>
                  </td>
                  <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>{iv.role}</td>
                  <td style={{ padding: '10px 14px', color: '#9a6b00' }}>Invited</td>
                  {canManage && (
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <button onClick={() => revokeInvite(iv.id)}
                        style={{ border: 'none', background: 'transparent', color: '#c0392b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Revoke</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Member {
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  profile: { full_name: string | null; email: string | null } | null;
}

export default function PartnersTeam() {
  const { brand, role } = usePartnersContext();
  const [members, setMembers] = useState<Member[] | null>(null);
  const canManage = role === 'owner' || role === 'admin';

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      // profiles embed may return null per-row if profiles RLS blocks reading
      // another member's row — the UI falls back to a shortened id in that case.
      const { data } = await supabase
        .from('brand_members')
        .select('user_id, role, status, created_at, profiles!brand_members_user_id_fkey ( full_name, email )')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setMembers((data ?? []).map((r: any) => ({
        user_id: r.user_id, role: r.role, status: r.status, created_at: r.created_at,
        profile: r.profiles ?? null,
      })));
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  return (
    <div style={{ padding: 24, maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Team</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 18px' }}>People with access to {brand.name}.</p>

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
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.user_id} style={{ borderTop: '1px solid #f0f0f2' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                    {m.profile?.full_name || m.profile?.email || `${m.user_id.slice(0, 8)}…`}
                  </td>
                  <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>{m.role}</td>
                  <td style={{ padding: '10px 14px', textTransform: 'capitalize', color: m.status === 'active' ? '#188a4a' : '#9a6b00' }}>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <p style={{ fontSize: 12, color: '#a0a0a8', marginTop: 14 }}>
          {/* ponytail: invite/remove ships next — needs an email→profile lookup
              path. members_write RLS already permits owner/admin mutations. */}
          Inviting and removing teammates is coming next.
        </p>
      )}
    </div>
  );
}

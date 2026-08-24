// Admin · Stylists — the stylist roster with per-stylist analytics + the
// pending-applications queue (Phase 4).
//
// Roster table: every row in style_up_stylists (humans + AI) with thread
// count, clickout count (via affiliate_clicks.stylist_id, Phase 4
// migration), showroom size, and a link to their showroom page. Sortable.
//
// Applications: every stylist_applications row still pending, with
// Approve / Reject buttons. Approving creates (or links) a
// style_up_stylists row for that user; rejecting stamps the status +
// timestamp. Admin-arm RLS on stylist_applications (Phase 4 migration)
// permits both writes from the client with the admin session.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import '~/styles/admin.css';

type Gender = 'men' | 'women' | 'unisex';

interface StylistRow {
  id: string;
  name: string;
  is_human: boolean;
  is_active: boolean;
  gender_focus: Gender | null;
  avatar_url: string | null;
  specialty: string | null;
  threads: number;
  clickouts: number;
  showroom: number;
}

interface Application {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  sample_url: string | null;
  gender_focus: Gender | null;
  created_at: string;
  applicant_email: string | null;
}

export default function AdminStylistsPage() {
  const [rows, setRows] = useState<StylistRow[]>([]);
  const [pending, setPending] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [
      stylistsRes,
      threadsRes,
      clickoutsRes,
      showroomRes,
      appsRes,
    ] = await Promise.all([
      supabase.from('style_up_stylists')
        .select('id, name, is_human, is_active, gender_focus, avatar_url, specialty')
        .order('is_human', { ascending: false })
        .order('name', { ascending: true }),
      supabase.from('style_up_threads').select('stylist_id'),
      supabase.from('affiliate_clicks').select('stylist_id').not('stylist_id', 'is', null),
      supabase.from('stylist_showroom_products').select('stylist_id'),
      supabase.from('stylist_applications')
        .select('id, user_id, display_name, bio, sample_url, gender_focus, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
    ]);
    if (stylistsRes.error) { setError(stylistsRes.error.message); setLoading(false); return; }

    const threadCounts = new Map<string, number>();
    for (const t of (threadsRes.data as Array<{ stylist_id: string }> ?? [])) {
      threadCounts.set(t.stylist_id, (threadCounts.get(t.stylist_id) ?? 0) + 1);
    }
    const clickCounts = new Map<string, number>();
    for (const c of (clickoutsRes.data as Array<{ stylist_id: string }> ?? [])) {
      clickCounts.set(c.stylist_id, (clickCounts.get(c.stylist_id) ?? 0) + 1);
    }
    const showroomCounts = new Map<string, number>();
    for (const s of (showroomRes.data as Array<{ stylist_id: string }> ?? [])) {
      showroomCounts.set(s.stylist_id, (showroomCounts.get(s.stylist_id) ?? 0) + 1);
    }

    setRows((stylistsRes.data as Array<{
      id: string; name: string; is_human: boolean; is_active: boolean;
      gender_focus: Gender | null; avatar_url: string | null; specialty: string | null;
    }> ?? []).map(s => ({
      ...s,
      threads: threadCounts.get(s.id) ?? 0,
      clickouts: clickCounts.get(s.id) ?? 0,
      showroom: showroomCounts.get(s.id) ?? 0,
    })));

    // Best-effort applicant email lookup — helps triage when display_name is
    // ambiguous. Silent failure is fine; the column just reads null.
    const apps = (appsRes.data as Array<Omit<Application, 'applicant_email'>> ?? []);
    const userIds = [...new Set(apps.map(a => a.user_id))];
    let emailMap = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profs } = await supabase
        .from('profiles').select('id, email').in('id', userIds);
      emailMap = new Map(((profs ?? []) as Array<{ id: string; email: string | null }>).map(p => [p.id, p.email]));
    }
    setPending(apps.map(a => ({ ...a, applicant_email: emailMap.get(a.user_id) ?? null })));
    setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const approve = useCallback(async (app: Application) => {
    setBusyAppId(app.id);
    setError(null);
    // Idempotent: if a stylist row already exists for this user, reuse it;
    // otherwise create a new one with sensible defaults from the application.
    const { data: existing } = await supabase
      .from('style_up_stylists').select('id').eq('human_user_id', app.user_id).maybeSingle();
    if (!existing) {
      const { error: sErr } = await supabase.from('style_up_stylists').insert({
        name: app.display_name,
        is_human: true,
        human_user_id: app.user_id,
        gender_focus: app.gender_focus,
        bio: app.bio,
        is_active: true,
      });
      if (sErr) { setError(sErr.message); setBusyAppId(null); return; }
    }
    const { error: uErr } = await supabase.from('stylist_applications').update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    }).eq('id', app.id);
    if (uErr) { setError(uErr.message); setBusyAppId(null); return; }
    setBusyAppId(null);
    await loadAll();
  }, [loadAll]);

  const reject = useCallback(async (app: Application) => {
    setBusyAppId(app.id);
    setError(null);
    const { error: uErr } = await supabase.from('stylist_applications').update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
    }).eq('id', app.id);
    if (uErr) { setError(uErr.message); setBusyAppId(null); return; }
    setBusyAppId(null);
    await loadAll();
  }, [loadAll]);

  const { sortedData, sort, handleSort } = useSortableTable<StylistRow>(rows, { key: 'threads', direction: 'desc' });

  const totals = useMemo(() => ({
    stylists: rows.length,
    humans: rows.filter(r => r.is_human).length,
    threads: rows.reduce((a, b) => a + b.threads, 0),
    clickouts: rows.reduce((a, b) => a + b.clickouts, 0),
  }), [rows]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Stylists</h1>
        <div className="admin-page-subtitle">
          {totals.stylists} stylists · {totals.humans} humans · {totals.threads} threads · {totals.clickouts} clickouts
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {pending.length > 0 && (
        <section className="admin-section">
          <h2>Pending applications ({pending.length})</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Focus</th>
                  <th>Portfolio</th>
                  <th>Bio</th>
                  <th>Applied</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div>{a.display_name}</div>
                      {a.applicant_email && <div className="admin-cell-sub">{a.applicant_email}</div>}
                    </td>
                    <td>{a.gender_focus ?? '—'}</td>
                    <td>{a.sample_url ? <a href={a.sample_url} target="_blank" rel="noreferrer">link</a> : '—'}</td>
                    <td style={{ maxWidth: 320 }}>{a.bio ?? '—'}</td>
                    <td>{new Date(a.created_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="admin-btn admin-btn-primary" disabled={busyAppId === a.id} onClick={() => void approve(a)}>Approve</button>
                      <button className="admin-btn admin-btn-secondary" disabled={busyAppId === a.id} onClick={() => void reject(a)} style={{ marginLeft: 8 }}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="admin-section">
        <h2>Roster</h2>
        {loading ? <div className="admin-loading">Loading…</div> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <SortableTh label="Name" sortKey="name" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Type" sortKey="is_human" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Focus" sortKey="gender_focus" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Threads" sortKey="threads" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Clickouts" sortKey="clickouts" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Showroom" sortKey="showroom" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Active" sortKey="is_active" currentSort={sort} onSort={handleSort} />
                  <th style={{ textAlign: 'right' }}>Open</th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div>{r.name}</div>
                      {r.specialty && <div className="admin-cell-sub">{r.specialty}</div>}
                    </td>
                    <td>{r.is_human ? 'Human' : 'AI'}</td>
                    <td>{r.gender_focus ?? '—'}</td>
                    <td>{r.threads}</td>
                    <td>{r.clickouts}</td>
                    <td>{r.showroom}</td>
                    <td>{r.is_active ? 'Yes' : 'No'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.is_human ? (
                        <Link className="admin-btn admin-btn-secondary" to={`/admin/stylists/${r.id}`}>Details</Link>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from '@remix-run/react';
import { looks, creators, type Look } from '~/data/looks';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { supabase } from '~/utils/supabase';
import type { UserUpload, UserGeneration } from '~/services/user-generations';

function findCreatorHandle(displayName: string): string | null {
  for (const [handle, c] of Object.entries(creators)) {
    if (c.displayName.toLowerCase() === displayName.toLowerCase()) return handle;
  }
  return null;
}

function LookRow({ look, expanded, onToggle }: { look: Look; expanded: boolean; onToggle: () => void }) {
  const creator = creators[look.creator];
  return (
    <>
      <tr className="admin-clickable-row" onClick={onToggle}>
        <td className="admin-cell-name">
          <video
            src={`${import.meta.env.BASE_URL}${look.video}`}
            className="admin-look-thumb"
            muted
            playsInline
            preload="metadata"
          />
          <span>{look.title}</span>
        </td>
        <td>{creator?.displayName || look.creator}</td>
        <td><span className={`admin-gender-badge admin-gender-${look.gender}`}>{look.gender === 'men' ? 'Men' : 'Women'}</span></td>
        <td>{look.products.length}</td>
        <td className="admin-cell-muted">{look.description}</td>
        <td>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </td>
      </tr>
      {expanded && (
        <tr className="admin-look-products-row">
          <td colSpan={6}>
            <div className="admin-products-grid">
              {look.products.map((p, i) => (
                <div key={i} className="admin-product-card">
                  {p.image && <img src={p.image} alt={p.name} className="admin-product-img" />}
                  <div className="admin-product-info">
                    <span className="admin-product-name">{p.name}</span>
                    <span className="admin-product-brand">{p.brand}</span>
                    <span className="admin-product-price">{p.price}</span>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface LookTableRow {
  id: number;
  title: string;
  creatorName: string;
  gender: string;
  productCount: number;
  description: string;
}

export default function AdminUserDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const decoded = decodeURIComponent(name || '');

  const creatorHandle = findCreatorHandle(decoded);
  const creator = creatorHandle ? creators[creatorHandle] : null;
  const isCreator = !!creator;

  const creatorLooks = useMemo(() => {
    if (!creatorHandle) return [];
    return looks.filter(l => l.creator === creatorHandle);
  }, [creatorHandle]);

  const tableRows: LookTableRow[] = useMemo(() =>
    creatorLooks.map(l => ({
      id: l.id,
      title: l.title,
      creatorName: creator?.displayName || l.creator,
      gender: l.gender,
      productCount: l.products.length,
      description: l.description,
    })),
  [creatorLooks, creator]);

  const lookTable = useSortableTable(tableRows);
  const [expandedLook, setExpandedLook] = useState<number | null>(null);

  // Uploaded reference photos + Generate-page submissions for this user.
  // The admin page route keys off displayName (full_name or email prefix),
  // so we resolve to auth.users via profiles. We try full_name first, then
  // fall back to email-local-part so users without a full_name still match.
  // resolved=true once the lookup completes so the UI can distinguish
  // "still loading" from "no data".
  const [uploads, setUploads] = useState<UserUpload[]>([]);
  const [generations, setGenerations] = useState<UserGeneration[]>([]);
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    if (!supabase) { setResolved(true); return; }
    let cancelled = false;
    setResolved(false);
    (async () => {
      const byName = await supabase
        .from('profiles')
        .select('id')
        .ilike('full_name', decoded)
        .maybeSingle();
      let userId = byName.data?.id as string | undefined;
      if (!userId) {
        const byEmail = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', `${decoded}@%`)
          .maybeSingle();
        userId = byEmail.data?.id as string | undefined;
      }
      if (cancelled) return;
      if (!userId) { setResolved(true); return; }
      const [{ data: u }, { data: g }] = await Promise.all([
        supabase.from('user_uploads').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('user_generations').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setUploads((u || []) as UserUpload[]);
      setGenerations((g || []) as UserGeneration[]);
      setResolved(true);
    })();
    return () => { cancelled = true; };
  }, [decoded]);

  const totalProducts = creatorLooks.reduce((sum, l) => sum + l.products.length, 0);
  const uniqueBrands = new Set(creatorLooks.flatMap(l => l.products.map(p => p.brand)));

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <button className="admin-back-link" onClick={() => navigate('/admin/users')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back to Users
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {creator && <img src={creator.avatar} alt="" className="admin-user-avatar-img" style={{ width: 40, height: 40 }} />}
          <div>
            <h1>{decoded}</h1>
            <p className="admin-page-subtitle">{isCreator ? 'Creator profile and looks' : 'Shopper profile and activity'}</p>
          </div>
        </div>
      </div>

      <div className="admin-detail-grid">
        <div className="admin-detail-card">
          <h3>Profile</h3>
          <div className="admin-detail-rows">
            <div className="admin-detail-row"><span>Username</span><span>{decoded}</span></div>
            {creatorHandle && <div className="admin-detail-row"><span>Handle</span><span>{creatorHandle}</span></div>}
            <div className="admin-detail-row"><span>Status</span><span className="admin-status-active">Active</span></div>
            <div className="admin-detail-row"><span>Type</span><span>{isCreator ? 'Creator' : 'Shopper'}</span></div>
          </div>
        </div>
        <div className="admin-detail-card">
          <h3>Activity</h3>
          <div className="admin-detail-rows">
            <div className="admin-detail-row"><span>Looks</span><span>{creatorLooks.length + generations.length}</span></div>
            <div className="admin-detail-row"><span>Products</span><span>{totalProducts}</span></div>
            <div className="admin-detail-row"><span>Brands</span><span>{uniqueBrands.size}</span></div>
            <div className="admin-detail-row"><span>Reference photos</span><span>{uploads.length}</span></div>
            <div className="admin-detail-row"><span>Saved</span><span>0</span></div>
          </div>
        </div>
      </div>

      {isCreator && creatorLooks.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 className="admin-section-title">Looks ({creatorLooks.length})</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <SortableTh label="Look" sortKey="title" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <SortableTh label="Creator" sortKey="creatorName" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <SortableTh label="Gender" sortKey="gender" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <SortableTh label="Products" sortKey="productCount" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <SortableTh label="Description" sortKey="description" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {lookTable.sortedData.map(row => {
                  const look = creatorLooks.find(l => l.id === row.id)!;
                  return (
                    <LookRow
                      key={row.id}
                      look={look}
                      expanded={expandedLook === row.id}
                      onToggle={() => setExpandedLook(prev => prev === row.id ? null : row.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isCreator && (
        <div className="admin-detail-grid" style={{ marginTop: 16 }}>
          <div className="admin-detail-card">
            <h3>Recent Searches</h3>
            <p className="admin-detail-empty">No searches yet</p>
          </div>
          <div className="admin-detail-card">
            <h3>Recent Clicks</h3>
            <p className="admin-detail-empty">No clicks yet</p>
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <h2 className="admin-section-title">Reference photos ({uploads.length})</h2>
        {!resolved ? (
          <p className="admin-detail-empty">Loading…</p>
        ) : uploads.length === 0 ? (
          <p className="admin-detail-empty">No reference photos uploaded yet</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {uploads.map(u => (
              <a key={u.id} href={u.public_url} target="_blank" rel="noopener noreferrer"
                 style={{ display: 'block', aspectRatio: '3/4', borderRadius: 8, overflow: 'hidden', background: '#111' }}>
                <img src={u.public_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 className="admin-section-title">Generated looks ({generations.length})</h2>
        {!resolved ? (
          <p className="admin-detail-empty">Loading…</p>
        ) : generations.length === 0 ? (
          <p className="admin-detail-empty">No looks generated yet</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {generations.map(g => (
              <div key={g.id} style={{
                borderRadius: 8, overflow: 'hidden', background: '#fff',
                border: '1px solid #eee', padding: 10, fontSize: 12,
              }}>
                {g.video_url ? (
                  <video src={g.video_url} muted loop playsInline autoPlay
                    style={{ width: '100%', aspectRatio: '9/16', borderRadius: 6, objectFit: 'cover', background: '#000' }} />
                ) : (
                  <div style={{
                    width: '100%', aspectRatio: '9/16', borderRadius: 6, background: '#000',
                    color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11,
                  }}>
                    {g.status === 'failed' ? 'Failed' : 'Processing…'}
                  </div>
                )}
                <div style={{ marginTop: 8, color: '#1a1a1a', fontWeight: 600 }}>{g.style} · {g.height_label || '—'}</div>
                <div style={{ color: '#666', fontSize: 11 }}>{g.status} · {new Date(g.created_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Affiliate Performance — the money dashboard (/admin/affiliate, default
// tab). Reads the two tables the Shopnomix rails write:
//   affiliate_clicks       every outbound clickout (cid, surface, creator)
//   affiliate_conversions  commissions synced daily from the reporting API
// and answers the founder's three questions at a glance: how much are we
// making, which creators earned it (and what we owe them), and where the
// clicks come from.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '~/utils/supabase';

interface ClickRow {
  id: string;
  clicked_at: string;
  brand: string | null;
  surface: string;
  creator_handle: string | null;
  wrapped: boolean;
  product_url: string;
}

interface ConversionRow {
  commission_id: string;
  click_time: string | null;
  revenue: number;
  status: string | null;
  root_domain: string | null;
  creator_handle: string | null;
  creator_share: number;
}

const DAYS = 30;
const SURFACE_LABELS: Record<string, string> = {
  look: 'Looks',
  'look-product': 'Products via looks',
  'creator-catalog': 'Creator catalogs',
  product: 'Product pages',
  brand: 'Brand pages',
  feed: 'Feed',
};

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const merchantHost = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 40); }
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  CONFIRMED: { bg: '#dcfce7', fg: '#15803d' },
  OPEN: { bg: '#fef3c7', fg: '#92400e' },
  REJECTED: { bg: '#fee2e2', fg: '#b91c1c' },
};

export default function AffiliatePerformance() {
  const [clicks, setClicks] = useState<ClickRow[]>([]);
  const [conversions, setConversions] = useState<ConversionRow[]>([]);
  const [sharePct, setSharePct] = useState(50);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    void (async () => {
      const [c, v, dial] = await Promise.all([
        sb.from('affiliate_clicks')
          .select('id, clicked_at, brand, surface, creator_handle, wrapped, product_url')
          .gte('clicked_at', since).order('clicked_at', { ascending: false }).limit(5000),
        sb.from('affiliate_conversions')
          .select('commission_id, click_time, revenue, status, root_domain, creator_handle, creator_share')
          .gte('click_time', since).order('click_time', { ascending: false }).limit(5000),
        sb.from('app_settings').select('value').eq('key', 'affiliate_creator_share_pct').maybeSingle(),
      ]);
      setClicks((c.data ?? []) as ClickRow[]);
      setConversions(((v.data ?? []) as ConversionRow[]).map(r => ({
        ...r, revenue: Number(r.revenue) || 0, creator_share: Number(r.creator_share) || 0,
      })));
      if (dial.data) setSharePct(parseFloat(String((dial.data as { value: string }).value)) || 50);
      setLoading(false);
    })();
  }, []);

  const m = useMemo(() => {
    const earning = conversions.filter(c => c.status !== 'REJECTED');
    const revenue = earning.reduce((a, c) => a + c.revenue, 0);
    const confirmed = earning.filter(c => c.status === 'CONFIRMED').reduce((a, c) => a + c.revenue, 0);
    const creatorsOwed = earning.reduce((a, c) => a + c.creator_share, 0);
    const wrapped = clicks.filter(c => c.wrapped).length;
    const dayKey = (iso: string) => iso.slice(0, 10);
    const today = dayKey(new Date().toISOString());
    const days: { day: string; clicks: number; revenue: number }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      days.push({ day: dayKey(new Date(Date.now() - i * 86_400_000).toISOString()), clicks: 0, revenue: 0 });
    }
    const byDay = new Map(days.map(d => [d.day, d]));
    for (const c of clicks) byDay.get(dayKey(c.clicked_at))&& (byDay.get(dayKey(c.clicked_at))!.clicks += 1);
    for (const c of earning) {
      if (c.click_time && byDay.has(dayKey(c.click_time))) byDay.get(dayKey(c.click_time))!.revenue += c.revenue;
    }

    const creators = new Map<string, { clicks: number; conversions: number; revenue: number; share: number }>();
    for (const c of clicks) {
      if (!c.creator_handle) continue;
      const row = creators.get(c.creator_handle) ?? { clicks: 0, conversions: 0, revenue: 0, share: 0 };
      row.clicks++;
      creators.set(c.creator_handle, row);
    }
    for (const c of earning) {
      if (!c.creator_handle) continue;
      const row = creators.get(c.creator_handle) ?? { clicks: 0, conversions: 0, revenue: 0, share: 0 };
      row.conversions++;
      row.revenue += c.revenue;
      row.share += c.creator_share;
      creators.set(c.creator_handle, row);
    }

    const surfaces = new Map<string, number>();
    for (const c of clicks) surfaces.set(c.surface, (surfaces.get(c.surface) ?? 0) + 1);

    const merchants = new Map<string, { clicks: number; revenue: number }>();
    for (const c of clicks) {
      const host = merchantHost(c.product_url);
      const row = merchants.get(host) ?? { clicks: 0, revenue: 0 };
      row.clicks++;
      merchants.set(host, row);
    }
    for (const c of earning) {
      if (!c.root_domain) continue;
      const row = merchants.get(c.root_domain) ?? { clicks: 0, revenue: 0 };
      row.revenue += c.revenue;
      merchants.set(c.root_domain, row);
    }

    return {
      revenue, confirmed, creatorsOwed,
      houseNet: revenue - creatorsOwed,
      wrappedRate: clicks.length ? wrapped / clicks.length : 0,
      clicksToday: clicks.filter(c => dayKey(c.clicked_at) === today).length,
      epc: wrapped ? revenue / wrapped : 0,
      convRate: wrapped ? conversions.length / wrapped : 0,
      days,
      creators: [...creators.entries()].sort((a, b) => b[1].share - a[1].share || b[1].clicks - a[1].clicks),
      surfaces: [...surfaces.entries()].sort((a, b) => b[1] - a[1]),
      merchants: [...merchants.entries()].sort((a, b) => b[1].revenue - a[1].revenue || b[1].clicks - a[1].clicks).slice(0, 8),
    };
  }, [clicks, conversions]);

  const maxDayClicks = Math.max(1, ...m.days.map(d => d.clicks));
  const maxDayRevenue = Math.max(0.01, ...m.days.map(d => d.revenue));
  const maxSurface = Math.max(1, ...m.surfaces.map(([, n]) => n));

  const tiles = [
    { label: `Clicks · ${DAYS}d`, value: clicks.length.toLocaleString(), sub: `${m.clicksToday} today · ${pct(m.wrappedRate)} monetized` },
    { label: 'Conversions', value: conversions.length.toLocaleString(), sub: `${pct(m.convRate)} of monetized clicks` },
    { label: 'Commission revenue', value: usd(m.revenue), sub: `${usd(m.confirmed)} confirmed · EPC ${usd(m.epc)}` },
    { label: 'Creators owed', value: usd(m.creatorsOwed), sub: `${sharePct}% share of attributed sales` },
    { label: 'House net', value: usd(m.houseNet), sub: 'revenue − creator share' },
  ];

  return (
    <div>
      {/* ── Headline money ───────────────────────────────────────────── */}
      <div className="admin-stats-grid">
        {tiles.map(t => (
          <div key={t.label} className="admin-stat-card">
            <span className="admin-stat-value">{loading ? '…' : t.value}</span>
            <span className="admin-stat-label">{t.label}</span>
            <span style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{loading ? '' : t.sub}</span>
          </div>
        ))}
      </div>

      {/* ── 30-day rhythm: clicks (bars) + revenue (line) ─────────────── */}
      <section style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Last {DAYS} days</h2>
          <span style={{ fontSize: 11.5, color: '#9ca3af' }}>
            <i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#a78bfa', marginRight: 5 }} />clicks
            <i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 999, background: '#d4a017', margin: '0 5px 0 14px' }} />revenue (by click day)
          </span>
        </div>
        <svg viewBox={`0 0 ${DAYS * 24} 120`} style={{ width: '100%', height: 120, display: 'block' }} preserveAspectRatio="none">
          {m.days.map((d, i) => (
            <rect key={d.day} x={i * 24 + 4} width={16}
              y={110 - (d.clicks / maxDayClicks) * 100}
              height={(d.clicks / maxDayClicks) * 100 || 1}
              rx={3} fill="#a78bfa" opacity={d.clicks ? 0.85 : 0.18} />
          ))}
          <polyline fill="none" stroke="#d4a017" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
            points={m.days.map((d, i) => `${i * 24 + 12},${110 - (d.revenue / maxDayRevenue) * 96}`).join(' ')} />
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#c4c4cc', marginTop: 4 }}>
          <span>{m.days[0]?.day.slice(5)}</span><span>{m.days[Math.floor(DAYS / 2)]?.day.slice(5)}</span><span>today</span>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 20, alignItems: 'start' }}>
        {/* ── Creator payouts — the revenue-share ledger ───────────────── */}
        <section style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '18px 20px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15 }}>Creator payouts</h2>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#9ca3af' }}>
            Clicks from a creator&rsquo;s looks, catalog, or profile attribute their sales — they earn {sharePct}% of the commission.
          </p>
          {m.creators.length === 0 ? (
            <p style={{ fontSize: 13, color: '#9ca3af', padding: '14px 0' }}>
              No creator-attributed clicks yet — they start counting the moment someone shops from a look or creator catalog.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#9ca3af', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  <th style={{ padding: '6px 0' }}>Creator</th>
                  <th style={{ textAlign: 'right' }}>Clicks</th>
                  <th style={{ textAlign: 'right' }}>Sales</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Owed</th>
                </tr>
              </thead>
              <tbody>
                {m.creators.slice(0, 12).map(([handle, row]) => (
                  <tr key={handle} style={{ borderTop: '1px solid #f4f4f5' }}>
                    <td style={{ padding: '8px 0', fontWeight: 600 }}>{handle.startsWith('user:') ? `user ${handle.slice(5, 13)}` : handle}</td>
                    <td style={{ textAlign: 'right', color: '#6b7280' }}>{row.clicks}</td>
                    <td style={{ textAlign: 'right', color: '#6b7280' }}>{row.conversions}</td>
                    <td style={{ textAlign: 'right' }}>{usd(row.revenue)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: row.share > 0 ? '#15803d' : '#9ca3af' }}>{usd(row.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Where clicks come from ───────────────────────────────────── */}
        <section style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '18px 20px' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>Click sources</h2>
          {m.surfaces.length === 0 ? (
            <p style={{ fontSize: 13, color: '#9ca3af', padding: '14px 0' }}>No clicks recorded yet.</p>
          ) : m.surfaces.map(([surface, n]) => (
            <div key={surface} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 150, fontSize: 12.5, color: '#374151' }}>{SURFACE_LABELS[surface] ?? surface}</span>
              <div style={{ flex: 1, height: 18, background: '#f4f4f5', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ width: `${(n / maxSurface) * 100}%`, height: '100%', background: surface === 'feed' ? '#cbd5e1' : '#a78bfa', borderRadius: 6 }} />
              </div>
              <span style={{ width: 44, textAlign: 'right', fontSize: 12.5, fontWeight: 600 }}>{n}</span>
            </div>
          ))}
          <h2 style={{ margin: '20px 0 10px', fontSize: 15 }}>Top merchants</h2>
          {m.merchants.map(([host, row]) => (
            <div key={host} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderTop: '1px solid #f8f8f8' }}>
              <span style={{ color: '#374151' }}>{host}</span>
              <span style={{ color: '#6b7280' }}>{row.clicks} clicks{row.revenue > 0 && <b style={{ color: '#15803d', marginLeft: 8 }}>{usd(row.revenue)}</b>}</span>
            </div>
          ))}
        </section>
      </div>

      {/* ── Live tape: latest clicks + conversions ───────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 20, alignItems: 'start', marginTop: 20 }}>
        <section style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '18px 20px' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>Latest clicks</h2>
          {clicks.slice(0, 12).map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '6px 0', borderTop: '1px solid #f8f8f8' }}>
              <i title={c.wrapped ? 'Monetized' : 'Excluded brand (sent direct)'} style={{
                width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                background: c.wrapped ? '#22c55e' : '#d1d5db',
              }} />
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.brand || merchantHost(c.product_url)}</span>
              <span style={{ color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {SURFACE_LABELS[c.surface] ?? c.surface}{c.creator_handle ? ` · ${c.creator_handle}` : ''}
              </span>
              <span style={{ color: '#c4c4cc', whiteSpace: 'nowrap' }}>{timeAgo(c.clicked_at)}</span>
            </div>
          ))}
          {clicks.length === 0 && !loading && (
            <p style={{ fontSize: 13, color: '#9ca3af' }}>Clicks appear here in real time as shoppers tap out to merchants.</p>
          )}
        </section>

        <section style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '18px 20px' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>Latest conversions</h2>
          {conversions.slice(0, 12).map(c => {
            const colors = STATUS_COLORS[c.status ?? ''] ?? { bg: '#f4f4f5', fg: '#6b7280' };
            return (
              <div key={c.commission_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '6px 0', borderTop: '1px solid #f8f8f8' }}>
                <span style={{ fontWeight: 700 }}>{usd(c.revenue)}</span>
                <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: colors.bg, color: colors.fg }}>{c.status ?? '—'}</span>
                <span style={{ color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {c.root_domain ?? ''}{c.creator_handle ? ` · ${c.creator_handle} earns ${usd(c.creator_share)}` : ''}
                </span>
                <span style={{ color: '#c4c4cc', whiteSpace: 'nowrap' }}>{c.click_time ? timeAgo(c.click_time) : ''}</span>
              </div>
            );
          })}
          {conversions.length === 0 && !loading && (
            <p style={{ fontSize: 13, color: '#9ca3af' }}>
              No commissions yet — Shopnomix conversions sync every morning at 11:00 UTC and land here with the creator&rsquo;s cut precomputed.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

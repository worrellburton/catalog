import { useState } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

const engagementData = [
  { creator: 'emkrama', avatar: '', incomingTaps: 0, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'caitlyncoyle98', avatar: '', incomingTaps: 0, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'saintgerard', avatar: '', incomingTaps: 0, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'alexdelena', avatar: '', incomingTaps: 1, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'joedawson', avatar: '', incomingTaps: 5, outgoingTaps: 0, incomingClickouts: 7, outgoingClickouts: 0 },
  { creator: 'Anastasia', avatar: '', incomingTaps: 0, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'stas', avatar: '', incomingTaps: 0, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'andrey', avatar: '', incomingTaps: 0, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'agoop', avatar: '', incomingTaps: 0, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'cohenzach', avatar: '', incomingTaps: 0, outgoingTaps: 0, incomingClickouts: 0, outgoingClickouts: 0 },
  { creator: 'martin123', avatar: '', incomingTaps: 0, outgoingTaps: 3, incomingClickouts: 0, outgoingClickouts: 2 },
];

type FilterType = 'creators' | 'shoppers';

export default function AdminEngagement() {
  const [filterType, setFilterType] = useState<FilterType>('creators');
  const [search, setSearch] = useState('');
  const table = useSortableTable(engagementData);

  const totalInTaps = engagementData.reduce((s, d) => s + d.incomingTaps, 0);
  const totalOutTaps = engagementData.reduce((s, d) => s + d.outgoingTaps, 0);
  const totalInClicks = engagementData.reduce((s, d) => s + d.incomingClickouts, 0);
  const totalOutClicks = engagementData.reduce((s, d) => s + d.outgoingClickouts, 0);

  const filtered = table.sortedData.filter(d =>
    d.creator.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="admin-page">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Engagement</h1>
        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
          <span style={{ color: '#1976d2', fontWeight: 600 }}>Incoming Taps: {totalInTaps}</span>
          <span style={{ color: '#2e7d32', fontWeight: 600 }}>Outgoing Taps: {totalOutTaps}</span>
          <span>Incoming Clickouts: {totalInClicks}</span>
          <span>Outgoing Clickouts: {totalOutClicks}</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16, marginTop: 16 }}>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as FilterType)}
          className="admin-date-input"
          style={{ width: 140 }}
        >
          <option value="creators">Creators</option>
          <option value="shoppers">Shoppers</option>
        </select>
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="admin-date-input"
            style={{ paddingLeft: 28, width: 160 }}
          />
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh label="Creator" sortKey="creator" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Incoming Taps" sortKey="incomingTaps" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Outgoing Taps" sortKey="outgoingTaps" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Incoming Clickouts" sortKey="incomingClickouts" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Outgoing Clickouts" sortKey="outgoingClickouts" currentSort={table.sort} onSort={table.handleSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.creator}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="admin-user-avatar" style={{ background: '#e0e0e0', width: 28, height: 28, fontSize: 10 }}>
                      {row.creator.slice(0, 2).toUpperCase()}
                    </span>
                    <span style={{ fontWeight: 500 }}>{row.creator}</span>
                  </div>
                </td>
                <td style={{ color: row.incomingTaps > 0 ? '#1976d2' : undefined, fontWeight: row.incomingTaps > 0 ? 600 : 400 }}>{row.incomingTaps}</td>
                <td style={{ color: row.outgoingTaps > 0 ? '#2e7d32' : undefined, fontWeight: row.outgoingTaps > 0 ? 600 : 400 }}>{row.outgoingTaps}</td>
                <td style={{ color: row.incomingClickouts > 0 ? '#1976d2' : undefined, fontWeight: row.incomingClickouts > 0 ? 600 : 400 }}>{row.incomingClickouts}</td>
                <td style={{ color: row.outgoingClickouts > 0 ? '#2e7d32' : undefined, fontWeight: row.outgoingClickouts > 0 ? 600 : 400 }}>{row.outgoingClickouts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

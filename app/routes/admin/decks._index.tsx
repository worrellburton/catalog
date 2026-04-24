import { Link } from '@remix-run/react';

interface DeckInfo {
  id: string;
  label: string;
  description: string;
  current?: boolean;
}

const CURRENT_DECK: DeckInfo = {
  id: 'v1-1',
  label: 'Deck v1.1',
  description: 'Latest investor deck',
  current: true,
};

const PREVIOUS_DECKS: DeckInfo[] = [
  { id: 'v1', label: 'Deck v.1', description: 'Previous version' },
  { id: 'v9', label: 'Deck v.9', description: 'Previous version' },
  { id: 'v8', label: 'Deck v.8', description: 'Previous version' },
  { id: 'v7', label: 'Deck v.7', description: 'Earlier version' },
  { id: 'v6', label: 'Deck v.6', description: 'Earlier version' },
  { id: 'v5', label: 'Deck v.5', description: 'Original' },
];

function DeckCard({ d }: { d: DeckInfo }) {
  return (
    <Link
      to={`/admin/decks/${d.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 160,
        padding: 20,
        borderRadius: 12,
        border: '1px solid #e5e5e7',
        background: d.current ? 'linear-gradient(135deg, #0a0a0a 0%, #2a2a2c 100%)' : '#fff',
        color: d.current ? '#fff' : '#0a0a0a',
        textDecoration: 'none',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
    >
      <div>
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
          color: d.current ? 'rgba(255,255,255,0.6)' : '#86868b', marginBottom: 10,
        }}>
          {d.id.replace('-', '.').toUpperCase()}{d.current ? ' · Current' : ''}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {d.label}
        </div>
        <div style={{
          fontSize: 14, marginTop: 6,
          color: d.current ? 'rgba(255,255,255,0.7)' : '#6e6e73',
        }}>
          {d.description}
        </div>
      </div>
      <div style={{
        marginTop: 16, fontSize: 13, fontWeight: 500,
        color: d.current ? 'rgba(255,255,255,0.85)' : '#0a66c2',
      }}>
        Open deck →
      </div>
    </Link>
  );
}

export default function AdminDecksIndex() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Decks</h1>
        <div className="admin-page-subtitle">Investor decks, archived by version.</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
          color: '#86868b', marginBottom: 10,
        }}>
          Current version
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          <DeckCard d={CURRENT_DECK} />
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
          color: '#86868b', marginBottom: 10,
        }}>
          Previous versions
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {PREVIOUS_DECKS.map(d => <DeckCard key={d.id} d={d} />)}
        </div>
      </div>
    </div>
  );
}

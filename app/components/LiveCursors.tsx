import type { RemoteCursor } from '~/hooks/useLiveCursors';

interface LiveCursorsProps {
  cursors: RemoteCursor[];
}

export default function LiveCursors({ cursors }: LiveCursorsProps) {
  if (cursors.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {cursors.map(c => (
        <div
          key={c.id}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate3d(${c.x}px, ${c.y}px, 0)`,
            transition: 'transform 60ms linear',
            willChange: 'transform',
          }}
        >
          <svg width="20" height="22" viewBox="0 0 20 22" fill="none" style={{ display: 'block' }}>
            <path
              d="M1 1L19 9.5L11 11.5L8.5 19L1 1Z"
              fill={c.color}
              stroke="white"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              position: 'absolute',
              left: 18,
              top: 18,
              padding: '2px 8px',
              borderRadius: 10,
              background: c.color,
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              letterSpacing: '0.01em',
            }}
          >
            {c.name}
          </span>
        </div>
      ))}
    </div>
  );
}

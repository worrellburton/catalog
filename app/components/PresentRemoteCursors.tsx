import type { RemoteCursorState } from '~/hooks/usePresentCursors';

interface PresentRemoteCursorsProps {
  cursors: RemoteCursorState[];
}

/**
 * Fixed-position overlay that paints every remote participant's
 * cursor on top of the current page. Uses pointer-events:none on
 * the wrapper so cursors never block clicks; each cursor is a tiny
 * SVG pointer + a name pill in the participant's color. The
 * presenter's cursor is rendered slightly larger and with a "•"
 * dot in the pill so guests can tell whose hand is driving.
 */
export default function PresentRemoteCursors({ cursors }: PresentRemoteCursorsProps) {
  if (cursors.length === 0) return null;
  return (
    <div style={overlayStyle} aria-hidden="true">
      {cursors.map(c => (
        <RemoteCursor key={c.id} cursor={c} />
      ))}
    </div>
  );
}

function RemoteCursor({ cursor }: { cursor: RemoteCursorState }) {
  const isPresenter = cursor.role === 'presenter';
  // 0..1 ratio -> px, computed against the local viewport so guests
  // on different screen sizes still see proportional positions.
  const x = (typeof window !== 'undefined' ? window.innerWidth : 1) * cursor.x;
  const y = (typeof window !== 'undefined' ? window.innerHeight : 1) * cursor.y;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        // GPU-friendly transform avoids layout thrash at 60 fps.
        transform: `translate3d(${x}px, ${y}px, 0)`,
        willChange: 'transform',
      }}
    >
      <PointerSvg color={cursor.color} large={isPresenter} />
      <div
        style={{
          position: 'absolute',
          top: isPresenter ? 22 : 18,
          left: isPresenter ? 18 : 14,
          padding: isPresenter ? '4px 10px' : '3px 8px',
          borderRadius: 999,
          background: cursor.color,
          color: '#0a0a0a',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: isPresenter ? 12 : 11,
          fontWeight: 700,
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
          boxShadow: isPresenter
            ? `0 6px 18px ${cursor.color}55, 0 0 0 1px rgba(0,0,0,0.15)`
            : '0 4px 12px rgba(0,0,0,0.4)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {isPresenter && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: 'rgba(0,0,0,0.65)',
              flex: '0 0 auto',
            }}
          />
        )}
        {cursor.name}
      </div>
    </div>
  );
}

function PointerSvg({ color, large }: { color: string; large: boolean }) {
  const size = large ? 24 : 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))' }}
    >
      <path
        d="M5 3l14 7-7 1.7L8.5 19 5 3z"
        fill={color}
        stroke="rgba(0,0,0,0.6)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 9999,
};

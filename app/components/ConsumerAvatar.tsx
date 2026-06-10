/**
 * Consumer-facing avatar with a built-in broken-image fallback.
 *
 * Renders the URL when it loads; on error (404 / expired storage token /
 * missing file) it falls back to a stable gradient-initial circle instead
 * of the browser's broken-image glyph. Mirrors AdminAvatar's resilience
 * but without the AI/human color coding, and is self-contained (circular,
 * sized) so it drops in anywhere a creator/user avatar <img> lived.
 *
 * Pass a `className` for surface-specific extras (rings, borders); the
 * size + circle shape come from the `size` prop so it renders correctly
 * even with no CSS attached.
 */

import { useState, type CSSProperties } from 'react';

interface Props {
  name?: string | null;
  url?: string | null;
  size?: number;
  className?: string;
}

// Stable hue per name so the same person always gets the same shade.
function hueFor(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = (h * 33) ^ name.charCodeAt(i);
  return (h >>> 0) % 360;
}

export default function ConsumerAvatar({ name, url, size = 40, className }: Props) {
  const [errored, setErrored] = useState(false);
  const label = (name || '').trim();
  const initial = (label.charAt(0) || '?').toUpperCase();
  const base: CSSProperties = { width: size, height: size, borderRadius: '50%', flexShrink: 0 };

  if (url && !errored) {
    return (
      <img
        className={className}
        src={url}
        alt={label}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        style={{ ...base, objectFit: 'cover' }}
      />
    );
  }

  const hue = hueFor(label || '?');
  const bg = `linear-gradient(135deg, hsl(${hue} 60% 48%), hsl(${(hue + 38) % 360} 55% 40%))`;
  return (
    <span
      className={className}
      aria-label={label || undefined}
      style={{
        ...base,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        color: '#fff',
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initial}
    </span>
  );
}

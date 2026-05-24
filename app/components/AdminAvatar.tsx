/**
 * Robust admin avatar. Renders the URL when present + loadable, else
 * falls back to a gradient-initial circle with Human/AI color coding
 * (purple/cyan for is_ai, warm orange/red for human). Replaces the
 * bare <img> in lists that suffered when Google's avatar URL returned
 * its own initials fallback or when the URL was missing entirely.
 */

import { useState } from 'react';

interface Props {
  name: string;
  url?: string | null;
  isAi?: boolean;
  size?: number;
  className?: string;
}

// Stable hue per name so the same person always gets the same shade
// across renders. djb2 → 0..359.
function hueFor(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = (h * 33) ^ name.charCodeAt(i);
  return ((h >>> 0) % 360);
}

export default function AdminAvatar({ name, url, isAi, size = 32, className }: Props) {
  const [errored, setErrored] = useState(false);
  const initial = (name?.trim()?.charAt(0) || '?').toUpperCase();
  const showImage = url && !errored;

  if (showImage) {
    return (
      <img
        className={`adm-avatar adm-avatar-img ${className ?? ''}`}
        src={url}
        alt={name}
        width={size}
        height={size}
        onError={() => setErrored(true)}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        style={{ width: size, height: size }}
      />
    );
  }

  // Gradient initial. AI personas always get the purple/cyan brand
  // gradient; humans get a stable hue derived from their name so the
  // list reads as a real palette rather than one repeated orange.
  const bg = isAi
    ? 'linear-gradient(135deg, #a855f7 0%, #6366f1 60%, #06b6d4 100%)'
    : `linear-gradient(135deg, hsl(${hueFor(name)} 70% 52%), hsl(${(hueFor(name) + 38) % 360} 65% 45%))`;
  return (
    <span
      className={`adm-avatar adm-avatar-fallback ${className ?? ''}`}
      style={{
        width: size, height: size,
        background: bg,
        fontSize: Math.round(size * 0.42),
      }}
      aria-label={name}
    >
      {initial}
    </span>
  );
}

// imports
import type { CSSProperties } from 'react';

// types
interface TypeIconProps {
  /** 24×24 path data from product_types.icon_path (drawn by the
   *  generate-type-icons function). Null falls back to a plain ring. */
  path: string | null;
  size?: number;
  style?: CSSProperties;
}

// main logic
export default function TypeIcon({ path, size = 28, style }: TypeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {path ? <path d={path} /> : <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

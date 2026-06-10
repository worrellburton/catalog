/**
 * Count-up animation for stat numbers. Mounts at 0 and rolls to the
 * target value using requestAnimationFrame so large numbers feel
 * tactile rather than just appearing. Respects prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

const DEFAULT_FORMAT = (n: number) => n.toLocaleString();

export default function CountUp({ value, duration = 900, format = DEFAULT_FORMAT, className }: Props) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(value);

  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || value === fromRef.current) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast start, soft landing.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (to - from) * eased);
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return <span className={className}>{format(display)}</span>;
}

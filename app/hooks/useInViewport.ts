import { useEffect, useState, type RefObject } from 'react';

// Shared IntersectionObserver pool. The consumer feed renders 50–200 tiles
// (LookCard + CreativeCard); previously each tile spun up its own
// IntersectionObserver instance. One observer per rootMargin is sufficient
// — the browser fires a single scroll-tick callback per observer, so
// pooling collapses dozens of independent dispatches into one batch.

type Callback = (visible: boolean) => void;

interface Pool {
  observer: IntersectionObserver;
  callbacks: Map<Element, Callback>;
}

const pools = new Map<string, Pool>();

function getPool(rootMargin: string): Pool {
  let pool = pools.get(rootMargin);
  if (pool) return pool;

  const callbacks = new Map<Element, Callback>();
  const observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        const cb = callbacks.get(entry.target);
        if (cb) cb(entry.isIntersecting);
      }
    },
    { rootMargin },
  );
  pool = { observer, callbacks };
  pools.set(rootMargin, pool);
  return pool;
}

export function useInViewport(
  ref: RefObject<Element | null>,
  // Default: 2 viewports above + below. Using % (relative to the root /
  // viewport) instead of a fixed px value so phones, tablets, and
  // desktops all get the same "2 screens ahead" prep band proportional
  // to whatever device they're on. Mobile portrait ≈ 1600px each side,
  // desktop ≈ 2000px each side — more than enough for full buffer.
  rootMargin = '200% 0%',
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const pool = getPool(rootMargin);
    pool.callbacks.set(el, setVisible);
    pool.observer.observe(el);

    return () => {
      pool.callbacks.delete(el);
      pool.observer.unobserve(el);
    };
  }, [ref, rootMargin]);

  return visible;
}

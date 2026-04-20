
import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { looks as staticRawLooks, creators, Look } from '~/data/looks';
import { getLooks } from '~/services/looks';
import { useHiddenLooks, useHiddenProductKeys } from '~/hooks/useHiddenLooks';
import LookCard from './LookCard';

interface GridViewProps {
  activeFilter: 'all' | 'men' | 'women';
  searchQuery: string;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (creatorName: string) => void;
  onCreateCatalog?: (query: string) => void;
  isLightMode: boolean;
  shuffleKey?: number;
  layoutMode?: number;
}

const LAYOUT_CONFIGS = [
  { name: 'grid', minWidth: 240 },
  { name: 'editorial', minWidth: 300 },
  { name: 'mosaic', minWidth: 160 },
  { name: 'spotlight', minWidth: 400 },
];

const BATCH_SIZE = 12;

function ParticleField({ isLightMode }: { isLightMode: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let w = 0, h = 0;

    const particles: { x: number; y: number; z: number; vx: number; vy: number; size: number; alpha: number }[] = [];
    const PARTICLE_COUNT = 200;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }

    function init() {
      resize();
      particles.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          z: Math.random(),
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          size: Math.random() * 2 + 0.5,
          alpha: Math.random() * 0.6 + 0.1,
        });
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);

      const baseColor = isLightMode ? '0, 0, 0' : '255, 255, 255';

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        // Twinkle
        p.alpha += (Math.random() - 0.5) * 0.02;
        p.alpha = Math.max(0.05, Math.min(0.7, p.alpha));

        const size = p.size * (0.5 + p.z * 0.5);

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${baseColor}, ${p.alpha * p.z})`;
        ctx!.fill();
      }

      // Draw connections between close particles (squared distance to avoid sqrt)
      const maxDist = 100;
      const maxDistSq = maxDist * maxDist;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          if (distSq < maxDistSq) {
            const dist = Math.sqrt(distSq);
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(${baseColor}, ${0.04 * (1 - dist / maxDist)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }

    init();
    draw();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [isLightMode]);

  return <canvas ref={canvasRef} className="no-results-canvas" />;
}

export default function GridView({ activeFilter, searchQuery, onOpenLook, onOpenCreator, onCreateCatalog, isLightMode, shuffleKey = 0, layoutMode = 0 }: GridViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const layout = LAYOUT_CONFIGS[layoutMode % LAYOUT_CONFIGS.length];
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  // Hide admin-deleted looks + strip admin-deleted products from remaining looks.
  const hiddenLookIds = useHiddenLooks();
  const hiddenProductKeys = useHiddenProductKeys();

  // Pull the live look set from Supabase so the grid mirrors the admin's
  // Content → Looks tab exactly. Static seed is only the fallback.
  const [dbLooks, setDbLooks] = useState<Look[]>(staticRawLooks);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched = await getLooks();
        if (!cancelled && fetched.length > 0) setDbLooks(fetched);
      } catch {
        // keep static fallback
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const looks = useMemo(() => (
    dbLooks
      .filter(l => !hiddenLookIds.has(l.id))
      .map(l => ({
        ...l,
        products: l.products.filter(p => !hiddenProductKeys.has(`${p.brand}-${p.name}`)),
      }))
  ), [dbLooks, hiddenLookIds, hiddenProductKeys]);

  const filteredLooks = useMemo(() => {
    let filtered = activeFilter === 'all' ? looks : looks.filter(l => l.gender === activeFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.creator.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.products.some(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [activeFilter, searchQuery, looks]);

  // Infinite pool = shuffle the full admin look set, lay it down, repeat.
  const infinitePool = useMemo(() => {
    if (filteredLooks.length === 0) return [];
    const poolSize = 200;
    const result: (Look & { displayIndex: number })[] = [];
    let displayIndex = 0;
    void shuffleKey;
    while (result.length < poolSize) {
      const deck = [...filteredLooks];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      for (const look of deck) {
        if (result.length >= poolSize) break;
        result.push({ ...look, displayIndex: displayIndex++ });
      }
    }
    return result;
  }, [filteredLooks, shuffleKey]);

  const displayLooks = useMemo(() => {
    return infinitePool.slice(0, visibleCount);
  }, [infinitePool, visibleCount]);

  // Reset visible count when filter/search/shuffle changes
  useEffect(() => {
    setVisibleCount(BATCH_SIZE);
  }, [activeFilter, searchQuery, shuffleKey, layoutMode]);

  // Infinite scroll: observe sentinel at bottom
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || filteredLooks.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount(prev => Math.min(prev + BATCH_SIZE, infinitePool.length));
      }
    }, { rootMargin: '400px' });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredLooks.length, infinitePool.length]);

  const gridStyle = useMemo(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      return {};
    }
    return { gridTemplateColumns: `repeat(auto-fill, minmax(${layout.minWidth}px, 1fr))` };
  }, [layout.minWidth]);

  const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;

  const getCardClass = useCallback((globalIndex: number) => {
    if (!isDesktop || shuffleKey === 0) return 'look-card';
    const seed = (shuffleKey * 7 + globalIndex * 13) % 20;
    if (seed === 0) return 'look-card look-card-featured';
    if (seed === 3 || seed === 7) return 'look-card look-card-wide';
    return 'look-card';
  }, [shuffleKey, isDesktop]);

  if (filteredLooks.length === 0 && searchQuery) {
    return (
      <div className="grid-viewport" id="grid-viewport">
        <div className="no-results-container">
          <ParticleField isLightMode={isLightMode} />
          <div className="no-results">
            <h3>Lost in the universe</h3>
            <p>No content matches &ldquo;{searchQuery}&rdquo;</p>
            <p className="no-results-hint">Try a different search or browse all looks</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`grid-viewport layout-${layout.name}`} id="grid-viewport">
      <div className="grid-container" id="grid-container" ref={gridRef} style={gridStyle}>
        {displayLooks.map((look) => (
          <LookCard
            key={`${look.id}-${look.displayIndex}-${shuffleKey}`}
            look={look}
            className={getCardClass(look.displayIndex)}
            onOpenLook={onOpenLook}
            onOpenCreator={onOpenCreator}
            onCreateCatalog={onCreateCatalog}
          />
        ))}
      </div>
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  );
}

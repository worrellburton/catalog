// /home2 — Home 2.0 (unlisted; reachable from the user menu, admin only).
// A from-scratch homepage that treats Catalog as a CATALOG: a white,
// editorial, print-issue layout — masthead, index with dotted leaders,
// numbered category spreads, a looks band, and a brand index. Every
// pixel is shoppable: products → /p/, looks → /l/, brands → /b/ (the
// home route's deep-link consumer opens the overlays).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { productSlug, lookSlug, brandSlug } from '~/utils/slug';
import { getLooks } from '~/services/looks';
import { lookPoster } from '~/services/media-resolver';
import { posterRendition } from '~/utils/poster-prefetch';
import type { Look } from '~/data/looks';
import '~/styles/home2.css';

interface Row {
  id: string;
  name: string;
  brand: string | null;
  price: string | null;
  type: string | null;
  type_path: string | null;
  is_elite: boolean | null;
  image: string | null;
}

const ISSUE_NO = (() => {
  // Issue number = days since the company's founding summer. Purely
  // editorial flavor — it ticks up daily like a real masthead.
  const epoch = Date.UTC(2025, 5, 1);
  return Math.max(1, Math.floor((Date.now() - epoch) / 86_400_000 / 7));
})();

export default function HomeTwo() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [looks, setLooks] = useState<Look[]>([]);

  useEffect(() => {
    document.documentElement.classList.add('home2-paper');
    return () => document.documentElement.classList.remove('home2-paper');
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('products')
      .select('id, name, brand, price, type, type_path, is_elite, primary_image_url, image_url')
      .eq('is_active', true)
      .limit(400)
      .then(({ data }) => {
        setRows(((data ?? []) as Array<Row & { primary_image_url: string | null; image_url: string | null }>)
          .map(r => ({ ...r, image: r.primary_image_url || r.image_url }))
          .filter(r => !!r.image));
      });
    void getLooks().then(all => setLooks(all.slice(0, 14)));
  }, []);

  // Spreads: group by the ROOT of type_path (the tier-1 type), elite and
  // priced items first so every spread leads with its best foot.
  const spreads = useMemo(() => {
    const byRoot = new Map<string, Row[]>();
    for (const r of rows) {
      const root = (r.type_path ?? r.type ?? 'more').split('/')[0].trim().toLowerCase() || 'more';
      byRoot.set(root, [...(byRoot.get(root) ?? []), r]);
    }
    return [...byRoot.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([root, items]) => ({
        root,
        items: [...items].sort((a, b) =>
          Number(!!b.is_elite) - Number(!!a.is_elite) || Number(!!b.price) - Number(!!a.price)),
      }))
      .filter(s => s.items.length >= 4);
  }, [rows]);

  const hero = spreads[0]?.items[0] ?? rows[0] ?? null;
  const brands = useMemo(
    () => [...new Set(rows.map(r => r.brand).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b)),
    [rows]);

  const openProduct = (r: Row) => {
    const slug = productSlug({ id: r.id, brand: r.brand, name: r.name });
    if (slug) navigate(`/p/${slug}`);
  };
  const openLook = (l: Look) => {
    const slug = lookSlug({
      id: l.id ?? null, uuid: l.uuid ?? null, creator: l.creator ?? null,
      creatorDisplayName: l.creatorDisplayName ?? null, title: l.title ?? null,
    });
    if (slug) navigate(`/l/${slug}`);
  };

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="h2-page">
      {/* ── Masthead ─────────────────────────────────────────────────── */}
      <header className="h2-masthead">
        <div className="h2-topline">
          <span>The shoppable catalog</span>
          <span>Issue No. {ISSUE_NO}</span>
          <span>{today}</span>
        </div>
        <h1 className="h2-wordmark">Catalog</h1>
        <p className="h2-dek">
          Every page is real inventory. Every picture is a doorway.
          Tap anything — it&rsquo;s yours in two clicks.
        </p>
        <div className="h2-rule h2-rule--double" />
      </header>

      {/* ── Hero spread ──────────────────────────────────────────────── */}
      {hero && (
        <section className="h2-hero">
          <button type="button" className="h2-hero-media" onClick={() => openProduct(hero)}>
            <img src={posterRendition(hero.image) ?? hero.image ?? ''} alt={hero.name} />
            <span className="h2-hero-tag">This week&rsquo;s cover</span>
          </button>
          <div className="h2-hero-copy">
            <p className="h2-kicker">From the editors</p>
            <h2>
              Shopping used to mean searching.
              <em> Here, it means looking.</em>
            </h2>
            <p className="h2-hero-body">
              We assembled {rows.length} pieces from {brands.length} houses into one
              living issue — refreshed daily, tuned to you. Start with the cover:
            </p>
            <button type="button" className="h2-hero-cta" onClick={() => openProduct(hero)}>
              <span className="h2-hero-brand">{hero.brand}</span>
              <span className="h2-hero-name">{hero.name}</span>
              <span className="h2-hero-price">{hero.price ?? 'Shop'} →</span>
            </button>
          </div>
        </section>
      )}

      {/* ── Index (table of contents, dotted leaders) ────────────────── */}
      <nav className="h2-index">
        <p className="h2-kicker">In this issue</p>
        {spreads.map((s, i) => (
          <a key={s.root} href={`#h2-${s.root}`} className="h2-index-row">
            <span className="h2-index-no">No. {String(i + 1).padStart(2, '0')}</span>
            <span className="h2-index-name">{s.root}</span>
            <span className="h2-index-leader" aria-hidden="true" />
            <span className="h2-index-count">{s.items.length} pieces</span>
          </a>
        ))}
        {looks.length > 0 && (
          <a href="#h2-looks" className="h2-index-row">
            <span className="h2-index-no">No. {String(spreads.length + 1).padStart(2, '0')}</span>
            <span className="h2-index-name">worn, in motion</span>
            <span className="h2-index-leader" aria-hidden="true" />
            <span className="h2-index-count">{looks.length} looks</span>
          </a>
        )}
      </nav>

      {/* ── Category spreads ─────────────────────────────────────────── */}
      {spreads.map((s, i) => (
        <section key={s.root} id={`h2-${s.root}`} className="h2-spread">
          <div className="h2-spread-head">
            <span className="h2-spread-no">No. {String(i + 1).padStart(2, '0')}</span>
            <h3>{s.root}</h3>
            <span className="h2-spread-count">{s.items.length} pieces</span>
          </div>
          <div className="h2-grid">
            {s.items.slice(0, 8).map(r => (
              <button key={r.id} type="button" className="h2-card" onClick={() => openProduct(r)}>
                <span className="h2-card-media">
                  <img src={posterRendition(r.image) ?? r.image ?? ''} alt={r.name} loading="lazy" decoding="async" />
                </span>
                {r.brand && <em>{r.brand}</em>}
                <strong>{r.name}</strong>
                <span className="h2-card-foot">
                  <b>{r.price ?? '—'}</b>
                  <i>Shop →</i>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {/* ── Looks band — the catalog, worn ───────────────────────────── */}
      {looks.length > 0 && (
        <section id="h2-looks" className="h2-spread">
          <div className="h2-spread-head">
            <span className="h2-spread-no">No. {String(spreads.length + 1).padStart(2, '0')}</span>
            <h3>worn, in motion</h3>
            <span className="h2-spread-count">tap a look — every piece inside is shoppable</span>
          </div>
          <div className="h2-looks-band">
            {looks.map(l => {
              const poster = lookPoster(l);
              if (!poster) return null;
              return (
                <button key={l.uuid || l.id} type="button" className="h2-look" onClick={() => openLook(l)}>
                  <img src={posterRendition(poster) ?? poster} alt="" loading="lazy" decoding="async" />
                  <span>{l.creatorDisplayName || l.creator}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Brand index ──────────────────────────────────────────────── */}
      <section className="h2-brands">
        <p className="h2-kicker">The houses · A–Z</p>
        <div className="h2-brands-grid">
          {brands.map(b => (
            <button key={b} type="button" onClick={() => navigate(`/b/${brandSlug(b)}`)}>{b}</button>
          ))}
        </div>
      </section>

      <footer className="h2-foot">
        <div className="h2-rule h2-rule--double" />
        <h1 className="h2-wordmark h2-wordmark--foot">Catalog</h1>
        <p>AI shopping doesn&rsquo;t have a home yet. You&rsquo;re standing in it.</p>
        <button type="button" className="h2-foot-cta" onClick={() => navigate('/')}>Enter the feed →</button>
      </footer>
    </div>
  );
}

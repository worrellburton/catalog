// Admin · one product, everything about it: media (with the image / video
// generation sequences), health, every stored fact, its creative videos and
// the full activity timeline. Linked from Data → Products (row name, media
// hover card, Activity dropdown).

// imports
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from '@remix-run/react';
import ProductPageFacts from '~/components/admin/product-page/ProductPageFacts';
import ProductPageMedia from '~/components/admin/product-page/ProductPageMedia';
import ProductActivityTimeline, { ActivityTotalsRow } from '~/components/admin/ProductActivityTimeline';
import {
  loadAdminProduct, loadProductCreatives, runProductMediaSequence,
  type AdminProduct, type MediaStep, type ProductCreativeClip,
} from '~/services/admin-product';
import { loadProductActivity, type ProductActivity } from '~/services/product-activity';
import { productHealth } from '~/utils/product-health';

// constants
const HEALTH_PILL = { ok: 'Healthy', warn: 'Check', fail: 'Fix' } as const;
const RENDER_POLL_MS = 5000;
const POSTER_WAIT_MS = 180_000;

// main logic
export default function AdminProductPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [missing, setMissing] = useState(false);
  const [creatives, setCreatives] = useState<ProductCreativeClip[]>([]);
  const [activity, setActivity] = useState<ProductActivity | null>(null);
  const [step, setStep] = useState<MediaStep | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const p = await loadAdminProduct(id);
    setProduct(p);
    setMissing(!p);
    return p;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    setActivity(null);
    setMissing(false);
    (async () => {
      const p = await reload();
      if (cancelled || !p) return;
      const [clips, act] = await Promise.all([loadProductCreatives(id), loadProductActivity(id, p.created_at)]);
      if (cancelled) return;
      setCreatives(clips);
      setActivity(act);
    })();
    return () => { cancelled = true; };
  }, [id, reload]);

  // While the primary video renders on fal's queue — and for a few minutes
  // after, until the DB trigger cuts its poster — refresh the row.
  const [posterWatchUntil, setPosterWatchUntil] = useState(0);
  const rendering = product?.primary_video_status === 'pending';
  const awaitingPoster = !!product?.primary_video_url && !product.primary_video_poster_url && Date.now() < posterWatchUntil;
  useEffect(() => {
    if (!rendering && !awaitingPoster) return;
    if (rendering) setPosterWatchUntil(Date.now() + POSTER_WAIT_MS);
    const t = window.setInterval(() => { void reload(); }, RENDER_POLL_MS);
    return () => window.clearInterval(t);
  }, [rendering, awaitingPoster, reload]);

  const health = useMemo(() => product && productHealth({
    name: product.name, brand: product.brand, price: product.price, url: product.url,
    primaryImageUrl: product.primary_image_url, primaryImagePolished: product.primary_image_polished,
    posterUrl: product.primary_video_poster_url, videoUrl: product.primary_video_url, urlStatus: product.url_status,
  }), [product]);

  const generate = useCallback(async (mode: 'image' | 'video') => {
    if (!product) return;
    setMessage(null);
    const err = await runProductMediaSequence(product, mode, setStep);
    setStep(null);
    await reload();
    setMessage(err ? `Failed: ${err}` : mode === 'image' ? 'Primary image polished' : 'Video queued');
  }, [product, reload]);

  if (missing) {
    return (
      <div className="admin-page admin-pp">
        <Link className="admin-pp-back" to="/admin/data?tab=products">← Products</Link>
        <p className="admin-activity-empty">This product doesn’t exist (or was deleted).</p>
      </div>
    );
  }
  if (!product || !health) {
    return <div className="admin-page admin-pp"><p className="admin-activity-empty">Loading product…</p></div>;
  }

  const live = product.is_active !== false;
  return (
    <div className="admin-page admin-pp">
      <button type="button" className="admin-pp-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/admin/data?tab=products'))}>
        ← Products
      </button>

      <div className="admin-pp-top">
        <ProductPageMedia product={product} media={health.media} step={step} onGenerate={mode => { void generate(mode); }} />

        <div className="admin-pp-info">
          {product.brand && (
            <Link className="admin-pp-brand" to={`/admin/brand/${encodeURIComponent(product.brand)}`}>{product.brand}</Link>
          )}
          <h1>{product.name || 'Untitled product'}</h1>
          <div className="admin-pp-meta">
            <span className="admin-pp-price">
              {product.discounted_price ? <><s>{product.price}</s> {product.discounted_price}</> : product.price || 'No price'}
            </span>
            <span className={`admin-pp-pill ${live ? 'is-live' : 'is-hidden'}`}>{live ? 'Live' : 'Hidden'}</span>
            <span className={`admin-pp-pill is-${health.level}`}>{HEALTH_PILL[health.level]} · {health.score}</span>
          </div>
          <div className="admin-pp-actions">
            {product.url && <a href={product.url} target="_blank" rel="noopener noreferrer">Open on retailer ↗</a>}
            <Link to={`/admin/pipeline/product/${product.id}`}>Pipeline journey</Link>
            <Link to={`/admin/data?tab=products&q=${encodeURIComponent(product.name || '')}`}>Find in Data</Link>
          </div>
          {message && <p className={`admin-pp-message${message.startsWith('Failed') ? ' is-error' : ''}`}>{message}</p>}
          <ProductPageFacts product={product} health={health} />
        </div>
      </div>

      <section className="admin-pp-section">
        <h2>Activity</h2>
        {activity ? (
          <div className="admin-pp-activity">
            <ActivityTotalsRow totals={activity.totals} />
            <ProductActivityTimeline items={activity.items} />
          </div>
        ) : (
          <p className="admin-activity-empty">Loading activity…</p>
        )}
      </section>

      {creatives.length > 0 && (
        <section className="admin-pp-section">
          <h2>Creative videos · {creatives.length}</h2>
          <div className="admin-pp-creatives">
            {creatives.map(c => (
              <figure key={c.id} className={c.enabled === false ? 'is-off' : ''}>
                {c.video_url
                  ? <video src={c.video_url} poster={c.thumbnail_url || undefined} muted loop playsInline preload="none" onMouseEnter={e => { void e.currentTarget.play().catch(() => {}); }} onMouseLeave={e => e.currentTarget.pause()} />
                  : <span className="admin-pp-hero-empty">{c.status || 'No video'}</span>}
                <figcaption>
                  {[c.model, c.status, c.enabled === false ? 'off' : null].filter(Boolean).join(' · ')}
                  <span>{(c.impressions ?? 0).toLocaleString()} seen · {(c.clicks ?? 0).toLocaleString()} clicks</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

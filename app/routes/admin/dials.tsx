import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getVideoStillRatio,
  setVideoStillRatio,
  subscribeVideoStillRatio,
  DEFAULT_VIDEO_STILL_RATIO,
  getProductsImageOnly,
  getShowBrandLogos,
  setShowBrandLogos,
  subscribeShowBrandLogos,
  DEFAULT_SHOW_BRAND_LOGOS,
  setProductsImageOnly,
  subscribeProductsImageOnly,
  DEFAULT_PRODUCTS_IMAGE_ONLY,
  getProductSimilarityThreshold,
  setProductSimilarityThreshold,
  subscribeProductSimilarityThreshold,
  DEFAULT_PRODUCT_SIMILARITY,
  getLookSimilarityThreshold,
  setLookSimilarityThreshold,
  subscribeLookSimilarityThreshold,
  DEFAULT_LOOK_SIMILARITY,
  getCommentsEnabled,
  setCommentsEnabled,
  subscribeCommentsEnabled,
  DEFAULT_COMMENTS_ENABLED,
  getUiOnScroll,
  setUiOnScroll,
  subscribeUiOnScroll,
  DEFAULT_UI_ON_SCROLL,
  getChromeOnScroll,
  setChromeOnScroll,
  subscribeChromeOnScroll,
  DEFAULT_CHROME_ON_SCROLL,
  getWaitlistMode,
  setWaitlistMode,
  subscribeWaitlistMode,
  DEFAULT_WAITLIST_MODE,
  getStylistEngineMethod,
  setStylistEngineMethod,
  subscribeStylistEngineMethod,
  DEFAULT_STYLIST_ENGINE_METHOD,
  type StylistEngineMethod,
  getLookVideoModel,
  setLookVideoModel,
  subscribeLookVideoModel,
  DEFAULT_LOOK_VIDEO_MODEL,
  getLookVideoQuality,
  setLookVideoQuality,
  subscribeLookVideoQuality,
  DEFAULT_LOOK_VIDEO_QUALITY,
  type LookVideoQuality,
  getLookVideoDuration,
  setLookVideoDuration,
  subscribeLookVideoDuration,
  DEFAULT_LOOK_VIDEO_DURATION,
  LOOK_VIDEO_DURATION_MIN,
  LOOK_VIDEO_DURATION_MAX,
  getLookVideoFallback,
  setLookVideoFallback,
  subscribeLookVideoFallback,
} from '~/services/dials';
import { backfillBrandLogos, type BackfillResult } from '~/services/brandLogos';
import { shouldBeVideo } from '~/utils/videoStillSplit';
import VideoPipelineCard from '~/components/admin/VideoPipelineCard';
import { Skeleton } from '~/components/ui/StateViews';
import { VIDEO_MODELS } from '~/constants/video-models';
import { PRICING_BY_SLUG } from '~/constants/video-model-pricing';
import { supabase } from '~/utils/supabase';

/**
 * /admin/dials — global tuning knobs that affect the whole catalog
 * surface. First dial: Video → Still image ratio. Phase 10 polish:
 * snap points + a live preview grid that mirrors the predicate the
 * consumer feed actually uses, so the admin knows what the result
 * will look like before they walk away from the page.
 */

const SNAP_POINTS = [0, 25, 50, 75, 100] as const;

// Stable demo grid for the preview — fixed ids so the predicate
// keeps the same cards on the same side as the admin drags.
const PREVIEW_CARD_IDS = Array.from({ length: 12 }, (_, i) => `preview-${i}`);

export default function AdminDials() {
  const [ratio, setRatio] = useState<number>(DEFAULT_VIDEO_STILL_RATIO);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  // Latest value we've ASKED to persist — used to ignore realtime
  // echoes of our own write so the slider doesn't jitter mid-drag.
  const inflightValue = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVideoStillRatio().then(v => {
      if (cancelled) return;
      setRatio(v);
      setLoaded(true);
    });
    const unsub = subscribeVideoStillRatio(v => {
      if (cancelled) return;
      if (inflightValue.current === v) return;
      setRatio(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const persist = (next: number) => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      inflightValue.current = next;
      setSaving(true);
      setVideoStillRatio(next)
        .catch(err => { setError(err.message || 'Save failed'); })
        .finally(() => {
          setSaving(false);
          window.setTimeout(() => {
            if (inflightValue.current === next) inflightValue.current = null;
          }, 1500);
        });
    }, 180);
  };

  const onSlide = (next: number) => {
    setRatio(next);
    setError(null);
    persist(next);
  };

  const previewSplit = useMemo(() => {
    const videoCount = PREVIEW_CARD_IDS.filter(id => shouldBeVideo(id, ratio)).length;
    return { videoCount, stillCount: PREVIEW_CARD_IDS.length - videoCount };
  }, [ratio]);

  // ── Products image-only toggle ──────────────────────────────────────
  // When ON, the consumer feed renders product tiles as static images
  // (looks still play video). Mirrors the ratio dial's
  // realtime-sync + optimistic-update pattern.
  const [productsImageOnly, setProductsImageOnlyState] = useState<boolean>(DEFAULT_PRODUCTS_IMAGE_ONLY);
  const [productsImageOnlyLoaded, setProductsImageOnlyLoaded] = useState(false);
  const [productsImageOnlySaving, setProductsImageOnlySaving] = useState(false);

  // Brand-logos dial state. Same pattern as products-image-only.
  const [showBrandLogos, setShowBrandLogosState] = useState<boolean>(DEFAULT_SHOW_BRAND_LOGOS);
  const [brandLogosLoaded, setBrandLogosLoaded] = useState(false);
  const [brandLogosSaving, setBrandLogosSaving] = useState(false);
  const inflightBrandLogos = useRef<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getShowBrandLogos().then(v => {
      if (cancelled) return;
      setShowBrandLogosState(v);
      setBrandLogosLoaded(true);
    });
    const unsub = subscribeShowBrandLogos(v => {
      if (cancelled) return;
      if (inflightBrandLogos.current === v) return;
      setShowBrandLogosState(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);
  const onToggleBrandLogos = (next: boolean) => {
    setShowBrandLogosState(next);
    inflightBrandLogos.current = next;
    setBrandLogosSaving(true);
    setShowBrandLogos(next)
      .catch(err => { setError(err.message || 'Save failed'); })
      .finally(() => {
        setBrandLogosSaving(false);
        window.setTimeout(() => {
          if (inflightBrandLogos.current === next) inflightBrandLogos.current = null;
        }, 1500);
      });
  };

  // Brand logos backfill — walks distinct product brands, probes
  // Brandfetch's CDN for each derived domain, and upserts the matching
  // brand_logos row. Lets the admin canonicalize the logo table in one
  // click instead of waiting for runtime lookups to populate it.
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ scanned: number; total: number; currentBrand?: string } | null>(null);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const runBackfill = async () => {
    setBackfillRunning(true);
    setBackfillError(null);
    setBackfillResult(null);
    setBackfillProgress({ scanned: 0, total: 0 });
    try {
      const result = await backfillBrandLogos((p) => {
        setBackfillProgress({ scanned: p.scanned, total: p.total, currentBrand: p.currentBrand });
      });
      setBackfillResult(result);
    } catch (err) {
      setBackfillError(err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setBackfillRunning(false);
      setBackfillProgress(null);
    }
  };
  const inflightProductsImageOnly = useRef<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProductsImageOnly().then(v => {
      if (cancelled) return;
      setProductsImageOnlyState(v);
      setProductsImageOnlyLoaded(true);
    });
    const unsub = subscribeProductsImageOnly(v => {
      if (cancelled) return;
      if (inflightProductsImageOnly.current === v) return;
      setProductsImageOnlyState(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);
  const onToggleProductsImageOnly = (next: boolean) => {
    setProductsImageOnlyState(next);
    inflightProductsImageOnly.current = next;
    setProductsImageOnlySaving(true);
    setProductsImageOnly(next)
      .catch(err => { setError(err.message || 'Save failed'); })
      .finally(() => {
        setProductsImageOnlySaving(false);
        window.setTimeout(() => {
          if (inflightProductsImageOnly.current === next) inflightProductsImageOnly.current = null;
        }, 1500);
      });
  };

  // ── Comments feature flag ───────────────────────────────────────────
  // When ON, products + looks show a Comment button that opens the thread
  // page. When OFF the button and the thread page are hidden everywhere.
  const [commentsEnabled, setCommentsEnabledState] = useState<boolean>(DEFAULT_COMMENTS_ENABLED);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsSaving, setCommentsSaving] = useState(false);
  const inflightComments = useRef<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCommentsEnabled().then(v => {
      if (cancelled) return;
      setCommentsEnabledState(v);
      setCommentsLoaded(true);
    });
    const unsub = subscribeCommentsEnabled(v => {
      if (cancelled) return;
      if (inflightComments.current === v) return;
      setCommentsEnabledState(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);
  const onToggleComments = (next: boolean) => {
    setCommentsEnabledState(next);
    inflightComments.current = next;
    setCommentsSaving(true);
    setCommentsEnabled(next)
      .catch(err => { setError(err.message || 'Save failed'); })
      .finally(() => {
        setCommentsSaving(false);
        window.setTimeout(() => {
          if (inflightComments.current === next) inflightComments.current = null;
        }, 1500);
      });
  };

  // ── Stylist engine method (A/B: style engine vs legacy recency) ─────
  const [stylistMethod, setStylistMethodState] = useState<StylistEngineMethod>(DEFAULT_STYLIST_ENGINE_METHOD);
  const [stylistMethodLoaded, setStylistMethodLoaded] = useState(false);
  const [stylistMethodSaving, setStylistMethodSaving] = useState(false);
  const inflightStylistMethod = useRef<StylistEngineMethod | null>(null);
  useEffect(() => {
    getStylistEngineMethod().then(v => {
      if (inflightStylistMethod.current) return;
      setStylistMethodState(v);
      setStylistMethodLoaded(true);
    });
    const unsub = subscribeStylistEngineMethod(v => {
      if (inflightStylistMethod.current === v) return;
      setStylistMethodState(v);
    });
    return () => unsub();
  }, []);
  const onSetStylistMethod = (next: StylistEngineMethod) => {
    if (next === stylistMethod) return;
    setStylistMethodState(next);
    inflightStylistMethod.current = next;
    setStylistMethodSaving(true);
    setStylistEngineMethod(next)
      .catch(() => setStylistMethodState(stylistMethod))
      .finally(() => {
        setStylistMethodSaving(false);
        if (inflightStylistMethod.current === next) inflightStylistMethod.current = null;
      });
  };

  // ── Look generation ("see it on me" try-on video) ───────────────────
  const [lookModel, setLookModel] = useState<string>(DEFAULT_LOOK_VIDEO_MODEL);
  const [lookQuality, setLookQuality] = useState<LookVideoQuality>(DEFAULT_LOOK_VIDEO_QUALITY);
  const [lookDuration, setLookDuration] = useState<number>(DEFAULT_LOOK_VIDEO_DURATION);
  const [lookFallback, setLookFallback] = useState<boolean>(false);
  const [lookLoaded, setLookLoaded] = useState(false);
  const [lookSaving, setLookSaving] = useState(false);
  const [lookCount, setLookCount] = useState<number | null>(null);
  useEffect(() => {
    Promise.all([
      getLookVideoModel(), getLookVideoQuality(), getLookVideoDuration(), getLookVideoFallback(),
    ]).then(([m, q, d, f]) => {
      setLookModel(m); setLookQuality(q); setLookDuration(d); setLookFallback(f);
      setLookLoaded(true);
    });
    const unsubs = [
      subscribeLookVideoModel(setLookModel),
      subscribeLookVideoQuality(setLookQuality),
      subscribeLookVideoDuration(setLookDuration),
      subscribeLookVideoFallback(setLookFallback),
    ];
    // Rough running spend estimate = how many looks have been generated so far.
    if (supabase) {
      void supabase.from('user_generations').select('id', { count: 'exact', head: true })
        .then(({ count }) => setLookCount(count ?? 0));
    }
    return () => unsubs.forEach(u => u());
  }, []);
  const saveLook = (fn: () => Promise<void>) => {
    setLookSaving(true);
    fn().catch(() => {}).finally(() => setLookSaving(false));
  };
  const onSetLookModel = (v: string) => { setLookModel(v); saveLook(() => setLookVideoModel(v)); };
  const onSetLookQuality = (v: LookVideoQuality) => { setLookQuality(v); saveLook(() => setLookVideoQuality(v)); };
  const onSetLookDuration = (v: number) => { setLookDuration(v); saveLook(() => setLookVideoDuration(v)); };
  const onSetLookFallback = (v: boolean) => { setLookFallback(v); saveLook(() => setLookVideoFallback(v)); };
  // A Seedance model's fast/pro tier is chosen by the quality dial at submit
  // time, so the cost estimate reflects the tier the render will actually use.
  const effectiveLookSlug = useMemo(() => {
    if (lookModel.startsWith('seedance') || lookModel.startsWith('bytedance/seedance')) {
      return lookQuality === 'pro'
        ? 'bytedance/seedance-2.0/reference-to-video'
        : 'bytedance/seedance-2.0/fast/reference-to-video';
    }
    return lookModel;
  }, [lookModel, lookQuality]);
  const lookCostPer = PRICING_BY_SLUG[effectiveLookSlug]?.costUsd ?? null;
  // Usable models only, grouped by provider for the <select>.
  const lookModelGroups = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const m of VIDEO_MODELS) {
      if (!m.usable) continue;
      const arr = groups.get(m.group) ?? [];
      arr.push({ value: m.value, label: m.label });
      groups.set(m.group, arr);
    }
    return Array.from(groups.entries());
  }, []);

  // ── UI on scroll (card chrome fade) ─────────────────────────────────
  // When ON, card chrome fades out while scrolling and eases back when the
  // feed settles. When OFF, the chrome stays put — nothing pops on scroll.
  const [uiOnScroll, setUiOnScrollState] = useState<boolean>(DEFAULT_UI_ON_SCROLL);
  const [uiOnScrollLoaded, setUiOnScrollLoaded] = useState(false);
  const [uiOnScrollSaving, setUiOnScrollSaving] = useState(false);
  const inflightUiOnScroll = useRef<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getUiOnScroll().then(v => {
      if (cancelled) return;
      setUiOnScrollState(v);
      setUiOnScrollLoaded(true);
    });
    const unsub = subscribeUiOnScroll(v => {
      if (cancelled) return;
      if (inflightUiOnScroll.current === v) return;
      setUiOnScrollState(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);
  const onToggleUiOnScroll = (next: boolean) => {
    setUiOnScrollState(next);
    inflightUiOnScroll.current = next;
    setUiOnScrollSaving(true);
    setUiOnScroll(next)
      .catch(err => { setError(err.message || 'Save failed'); })
      .finally(() => {
        setUiOnScrollSaving(false);
        window.setTimeout(() => {
          if (inflightUiOnScroll.current === next) inflightUiOnScroll.current = null;
        }, 1500);
      });
  };

  // ── App chrome on scroll (header + search) ──────────────────────────
  // When ON, the home header (Catalog + creators) and bottom search follow the
  // feed as you scroll. When OFF, they hide once you scroll past the hero
  // (immersive, media-only) and reappear at the very top.
  const [chromeOnScroll, setChromeOnScrollState] = useState<boolean>(DEFAULT_CHROME_ON_SCROLL);
  const [chromeOnScrollLoaded, setChromeOnScrollLoaded] = useState(false);
  const [chromeOnScrollSaving, setChromeOnScrollSaving] = useState(false);
  const inflightChromeOnScroll = useRef<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getChromeOnScroll().then(v => {
      if (cancelled) return;
      setChromeOnScrollState(v);
      setChromeOnScrollLoaded(true);
    });
    const unsub = subscribeChromeOnScroll(v => {
      if (cancelled) return;
      if (inflightChromeOnScroll.current === v) return;
      setChromeOnScrollState(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);
  const onToggleChromeOnScroll = (next: boolean) => {
    setChromeOnScrollState(next);
    inflightChromeOnScroll.current = next;
    setChromeOnScrollSaving(true);
    setChromeOnScroll(next)
      .catch(err => { setError(err.message || 'Save failed'); })
      .finally(() => {
        setChromeOnScrollSaving(false);
        window.setTimeout(() => {
          if (inflightChromeOnScroll.current === next) inflightChromeOnScroll.current = null;
        }, 1500);
      });
  };

  // ── Waitlist mode (launch master switch) ────────────────────────────
  // ON  → old flow (sign-in-only, guests → landing, new accounts → waitlist).
  // OFF → open flow (guests browse; looks/creators gate behind signup).
  const [waitlistMode, setWaitlistModeState] = useState<boolean>(DEFAULT_WAITLIST_MODE);
  const [waitlistLoaded, setWaitlistLoaded] = useState(false);
  const [waitlistSaving, setWaitlistSaving] = useState(false);
  const inflightWaitlist = useRef<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getWaitlistMode().then(v => {
      if (cancelled) return;
      setWaitlistModeState(v);
      setWaitlistLoaded(true);
    });
    const unsub = subscribeWaitlistMode(v => {
      if (cancelled) return;
      if (inflightWaitlist.current === v) return;
      setWaitlistModeState(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);
  const onToggleWaitlist = (next: boolean) => {
    setWaitlistModeState(next);
    inflightWaitlist.current = next;
    setWaitlistSaving(true);
    setWaitlistMode(next)
      .catch(err => { setError(err.message || 'Save failed'); })
      .finally(() => {
        setWaitlistSaving(false);
        window.setTimeout(() => {
          if (inflightWaitlist.current === next) inflightWaitlist.current = null;
        }, 1500);
      });
  };

  // ── Product similarity threshold ────────────────────────────────────
  const [productSimilarity, setProductSimilarityState] = useState(DEFAULT_PRODUCT_SIMILARITY);
  const [productSimilarityLoaded, setProductSimilarityLoaded] = useState(false);
  const [productSimilaritySaving, setProductSimilaritySaving] = useState(false);
  const [productSimilarityError, setProductSimilarityError] = useState<string | null>(null);
  const inflightProductSimilarity = useRef<number | null>(null);
  const productSimilarityTimer = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProductSimilarityThreshold().then(v => {
      if (cancelled) return;
      setProductSimilarityState(v);
      setProductSimilarityLoaded(true);
    });
    const unsub = subscribeProductSimilarityThreshold(v => {
      if (cancelled) return;
      if (inflightProductSimilarity.current === v) return;
      setProductSimilarityState(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);
  const onSlideProductSimilarity = (next: number) => {
    setProductSimilarityState(next);
    setProductSimilarityError(null);
    if (productSimilarityTimer.current != null) window.clearTimeout(productSimilarityTimer.current);
    productSimilarityTimer.current = window.setTimeout(() => {
      productSimilarityTimer.current = null;
      inflightProductSimilarity.current = next;
      setProductSimilaritySaving(true);
      setProductSimilarityThreshold(next)
        .catch(err => setProductSimilarityError(err.message || 'Save failed'))
        .finally(() => {
          setProductSimilaritySaving(false);
          window.setTimeout(() => {
            if (inflightProductSimilarity.current === next) inflightProductSimilarity.current = null;
          }, 1500);
        });
    }, 180);
  };

  // ── Look similarity threshold ────────────────────────────────────────
  const [lookSimilarity, setLookSimilarityState] = useState(DEFAULT_LOOK_SIMILARITY);
  const [lookSimilarityLoaded, setLookSimilarityLoaded] = useState(false);
  const [lookSimilaritySaving, setLookSimilaritySaving] = useState(false);
  const [lookSimilarityError, setLookSimilarityError] = useState<string | null>(null);
  const inflightLookSimilarity = useRef<number | null>(null);
  const lookSimilarityTimer = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getLookSimilarityThreshold().then(v => {
      if (cancelled) return;
      setLookSimilarityState(v);
      setLookSimilarityLoaded(true);
    });
    const unsub = subscribeLookSimilarityThreshold(v => {
      if (cancelled) return;
      if (inflightLookSimilarity.current === v) return;
      setLookSimilarityState(v);
    });
    return () => { cancelled = true; unsub(); };
  }, []);
  const onSlideLookSimilarity = (next: number) => {
    setLookSimilarityState(next);
    setLookSimilarityError(null);
    if (lookSimilarityTimer.current != null) window.clearTimeout(lookSimilarityTimer.current);
    lookSimilarityTimer.current = window.setTimeout(() => {
      lookSimilarityTimer.current = null;
      inflightLookSimilarity.current = next;
      setLookSimilaritySaving(true);
      setLookSimilarityThreshold(next)
        .catch(err => setLookSimilarityError(err.message || 'Save failed'))
        .finally(() => {
          setLookSimilaritySaving(false);
          window.setTimeout(() => {
            if (inflightLookSimilarity.current === next) inflightLookSimilarity.current = null;
          }, 1500);
        });
    }, 180);
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Dials</h1>
        <p className="admin-page-subtitle">
          Live-tuning knobs that affect everyone on Catalog. Changes
          apply across every device the moment you move a dial.
        </p>
      </div>

      <div className="admin-detail-grid" style={{ gridTemplateColumns: '1fr', maxWidth: 720 }}>
        <div className="admin-detail-card">
          <h3>Video → Still image ratio</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            How many cards in the catalog feed play as autoplay video
            versus render as still images. 100% = all video (current
            behaviour). 0% = all stills. The split is deterministic
            per-card so the same shopper sees the same set on refresh.
          </p>
          {!loaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={ratio}
                  onChange={e => onSlide(parseInt(e.target.value, 10))}
                  style={{ flex: 1 }}
                  aria-label="Video to still image ratio percent"
                />
                <div style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {ratio}%
                </div>
              </div>
              {/* Snap-point pills underneath the slider — one tap
                  jumps to a common value. The active pill outlines
                  itself so the current position reads at a glance. */}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {SNAP_POINTS.map(point => (
                  <button
                    key={point}
                    type="button"
                    onClick={() => onSlide(point)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                      borderRadius: 999,
                      border: `1px solid ${ratio === point ? '#1a1a1a' : '#e5e5e5'}`,
                      background: ratio === point ? '#1a1a1a' : '#fff',
                      color: ratio === point ? '#fff' : '#444',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {point}%
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#999' }}>
                <span>0% — all stills</span>
                <span>{saving ? 'Saving…' : 'Saved'}</span>
                <span>100% — all video</span>
              </div>
              {error && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>
              )}

              {/* Live preview — mirrors the predicate the consumer
                  feed uses. ▶ = video card, ▮ = still card. The
                  same set of preview ids keeps cards on the same
                  side as the admin drags, matching the per-card
                  determinism in shouldBeVideo. */}
              <div style={{ marginTop: 20, padding: '12px 14px', background: '#fafafa', borderRadius: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#666', marginBottom: 8 }}>
                  Live preview · {previewSplit.videoCount} video · {previewSplit.stillCount} still
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: 6,
                  }}
                >
                  {PREVIEW_CARD_IDS.map(id => {
                    const asVideo = shouldBeVideo(id, ratio);
                    return (
                      <div
                        key={id}
                        title={asVideo ? 'Plays as video' : 'Renders as still'}
                        style={{
                          aspectRatio: '3 / 4',
                          borderRadius: 6,
                          background: asVideo
                            ? 'linear-gradient(135deg, #1e293b, #0f172a)'
                            : '#e5e5e5',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: asVideo ? '#94a3b8' : '#94a3b8',
                          fontSize: 18,
                          transition: 'background 0.18s ease',
                        }}
                      >
                        {asVideo ? '▶' : '▮'}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <VideoPipelineCard device="desktop" />
        <VideoPipelineCard device="mobile" />

        <div className="admin-detail-card">
          <h3>Products: only show product image</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            When ON, every product tile in the consumer feed renders as
            a still product image — no autoplay video. Looks keep their
            video playback. Use this to silence the feed and lean on
            the clean catalog imagery brands already produce.
          </p>
          {!productsImageOnlyLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {productsImageOnly ? 'On' : 'Off'}
                </span>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {productsImageOnly
                    ? 'Products show as images. Looks still play video.'
                    : 'Products and looks both play video (default).'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {productsImageOnlySaving ? 'Saving…' : 'Saved'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={productsImageOnly}
                  onClick={() => onToggleProductsImageOnly(!productsImageOnly)}
                  style={{
                    position: 'relative',
                    width: 44,
                    height: 24,
                    borderRadius: 999,
                    border: 'none',
                    background: productsImageOnly ? '#16a34a' : '#cbd5e1',
                    cursor: 'pointer',
                    transition: 'background 160ms ease',
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: productsImageOnly ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      transition: 'left 160ms ease',
                    }}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="admin-detail-card">
          <h3>Show brand logos on the feed</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            When ON, every tile in the consumer feed shows the brand's
            logo image (from public.brand_logos) instead of the brand
            name text. Tiles whose brand doesn't have a logo registered
            fall back to the text — so flipping this dial never blanks
            a label.
          </p>
          {!brandLogosLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {showBrandLogos ? 'On' : 'Off'}
                </span>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {showBrandLogos
                    ? 'Brand logos render in place of brand names.'
                    : 'Brand names render as text (default).'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {brandLogosSaving ? 'Saving…' : 'Saved'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showBrandLogos}
                  onClick={() => onToggleBrandLogos(!showBrandLogos)}
                  style={{
                    position: 'relative', width: 44, height: 24, borderRadius: 999,
                    border: 'none', background: showBrandLogos ? '#16a34a' : '#cbd5e1',
                    cursor: 'pointer', transition: 'background 160ms ease', padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', top: 3, left: showBrandLogos ? 23 : 3,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      transition: 'left 160ms ease',
                    }}
                  />
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f2' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Fetch missing brand logos</span>
                <span style={{ fontSize: 11, color: '#999', lineHeight: 1.4 }}>
                  Walk every distinct brand in the products table, probe
                  Brandfetch's CDN for each derived domain, and upsert
                  the match into <code style={{ fontSize: 10 }}>brand_logos</code>.
                  Skips brands already registered and those without a
                  resolvable domain.
                </span>
              </div>
              <button
                type="button"
                onClick={runBackfill}
                disabled={backfillRunning}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #111',
                  background: backfillRunning ? '#fafafa' : '#111',
                  color: backfillRunning ? '#666' : '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: backfillRunning ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {backfillRunning ? 'Scanning…' : 'Run backfill'}
              </button>
            </div>

            {backfillRunning && backfillProgress && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {backfillProgress.total > 0
                      ? `${backfillProgress.scanned} / ${backfillProgress.total}`
                      : 'Counting brands…'}
                    {backfillProgress.currentBrand && (
                      <span style={{ color: '#999', marginLeft: 8, fontStyle: 'italic' }}>
                        {backfillProgress.currentBrand}
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ height: 4, background: '#e5e5e5', borderRadius: 999, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: backfillProgress.total > 0
                        ? `${Math.round((backfillProgress.scanned / backfillProgress.total) * 100)}%`
                        : '0%',
                      background: '#111',
                      transition: 'width 220ms ease',
                    }}
                  />
                </div>
              </div>
            )}

            {backfillResult && (
              <div style={{
                marginTop: 10,
                padding: '8px 12px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                fontSize: 12,
                color: '#166534',
                display: 'flex',
                gap: 14,
                flexWrap: 'wrap',
              }}>
                <span><strong>{backfillResult.added}</strong> added</span>
                <span style={{ color: '#475569' }}>·</span>
                <span><strong>{backfillResult.alreadyHad}</strong> already had</span>
                <span style={{ color: '#475569' }}>·</span>
                <span><strong>{backfillResult.skipped}</strong> skipped</span>
                <span style={{ color: '#475569' }}>·</span>
                <span><strong>{backfillResult.total}</strong> total brands</span>
              </div>
            )}

            {backfillError && (
              <div style={{
                marginTop: 10,
                padding: '8px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                fontSize: 12,
                color: '#991b1b',
              }}>
                {backfillError}
              </div>
            )}
          </div>
        </div>
        <div className="admin-detail-card" style={{ border: '1px solid #fde68a', background: '#fffbeb' }}>
          <h3>Waitlist mode <span style={{ fontSize: 11, fontWeight: 500, color: '#92400e', marginLeft: 6 }}>launch switch</span></h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            <strong>On</strong> keeps the app the way it was: sign-in-only,
            signed-out visitors land on the marketing page, and new accounts
            wait on the waitlist until approved. <strong>Off</strong> opens
            the app: guests browse the feed and products, looks and creator
            catalogs gate behind signup, and signing up grants access right
            away. Applies to every visitor in real time. To preview a flow on
            just this device without changing the global setting, open the
            site with <code>?flow=open</code> or <code>?flow=waitlist</code>
            {' '}(clear with <code>?flow=clear</code>).
          </p>
          {!waitlistLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {waitlistMode ? 'On — waitlist' : 'Off — app open'}
                </span>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {waitlistMode
                    ? 'Sign-in-only; new accounts hit the waitlist.'
                    : 'Guests browse; looks/creators gate behind signup.'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {waitlistSaving ? 'Saving…' : 'Saved'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={waitlistMode}
                  onClick={() => onToggleWaitlist(!waitlistMode)}
                  style={{
                    position: 'relative', width: 44, height: 24, borderRadius: 999,
                    border: 'none', background: waitlistMode ? '#16a34a' : '#cbd5e1',
                    cursor: 'pointer', transition: 'background 160ms ease', padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', top: 3, left: waitlistMode ? 23 : 3,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      transition: 'left 160ms ease',
                    }}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="admin-detail-card">
          <h3>Comments on products & looks</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            When ON, every product and look shows a Comment button that
            opens its comment thread (with the WebGL avatar field of the
            people in the thread). When OFF the button is hidden
            everywhere and the thread page reports comments are turned
            off. Existing comments are preserved either way.
          </p>
          {!commentsLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {commentsEnabled ? 'On' : 'Off'}
                </span>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {commentsEnabled
                    ? 'Shoppers can read and post comments.'
                    : 'Comment buttons hidden platform-wide.'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {commentsSaving ? 'Saving…' : 'Saved'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={commentsEnabled}
                  onClick={() => onToggleComments(!commentsEnabled)}
                  style={{
                    position: 'relative', width: 44, height: 24, borderRadius: 999,
                    border: 'none', background: commentsEnabled ? '#16a34a' : '#cbd5e1',
                    cursor: 'pointer', transition: 'background 160ms ease', padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', top: 3, left: commentsEnabled ? 23 : 3,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      transition: 'left 160ms ease',
                    }}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="admin-detail-card">
          <h3>Stylist engine (Style Up)</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            How the /style catalog stylist finds products. <b>Style engine</b> uses
            occasion-aware search and suggests a complete look directly (no slot
            chooser). <b>Stylist engine</b> adds anti-repeat: it skips pieces already
            shown in the thread and rotates the pool, so re-asking the same occasion
            returns a fresh look instead of the same one. <b>Legacy</b> restores the
            pre-engine behavior: the "Build your outfit" chooser and the 120-newest
            recency scan. Flip to compare — it applies to the next turn in every open
            chat.
          </p>
          {!stylistMethodLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                {(['style_engine', 'stylist_engine', 'legacy'] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onSetStylistMethod(opt)}
                    style={{
                      padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                      background: stylistMethod === opt ? '#111' : '#fff',
                      color: stylistMethod === opt ? '#fff' : '#555',
                    }}
                  >
                    {opt === 'style_engine' ? 'Style engine' : opt === 'stylist_engine' ? 'Stylist engine' : 'Legacy'}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: '#999' }}>{stylistMethodSaving ? 'Saving…' : 'Saved'}</span>
            </div>
          )}
        </div>

        <div className="admin-detail-card">
          <h3>Look generation <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', marginLeft: 6 }}>&ldquo;see it on me&rdquo;</span></h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            The video model that renders a shopper wearing their picks in the /style
            try-on. <b>Reference-to-video</b> models (Seedance, Vidu) see the product
            packshots; Veo image-to-video only sees the selfie, so it can&rsquo;t place
            the products — pick a reference model for accurate try-ons.
          </p>
          {!lookLoaded ? (
            <Skeleton height={220} radius={8} />
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Model picker */}
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Model</span>
                <select
                  value={lookModel}
                  onChange={e => onSetLookModel(e.target.value)}
                  style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
                >
                  {lookModelGroups.map(([group, opts]) => (
                    <optgroup key={group} label={group}>
                      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>

              {/* Quality tier (Seedance fast/pro) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Quality (Seedance tier)</span>
                <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  {(['fast', 'pro'] as const).map(opt => (
                    <button key={opt} type="button" onClick={() => onSetLookQuality(opt)}
                      style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                        background: lookQuality === opt ? '#111' : '#fff', color: lookQuality === opt ? '#fff' : '#555' }}>
                      {opt === 'fast' ? 'Fast' : 'Pro'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clip length */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Clip length</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="range" min={LOOK_VIDEO_DURATION_MIN} max={LOOK_VIDEO_DURATION_MAX} step={1}
                    value={lookDuration} onChange={e => onSetLookDuration(parseInt(e.target.value, 10))} />
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{lookDuration}s</span>
                </div>
              </div>

              {/* Fallback toggle */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ fontSize: 12, color: '#374151', maxWidth: 380, lineHeight: 1.4 }}>
                  <b>Allow face-only fallback</b> — when a product look can&rsquo;t render, animate the
                  selfie instead of failing. <span style={{ color: '#b45309' }}>Keep off: the fallback drops
                  the products and shows the shopper in their own clothes.</span>
                </span>
                <button type="button" onClick={() => onSetLookFallback(!lookFallback)}
                  style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                    background: lookFallback ? '#111' : '#fff', color: lookFallback ? '#fff' : '#555' }}>
                  {lookFallback ? 'On' : 'Off'}
                </button>
              </div>

              {/* Cost */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f0f0f0', paddingTop: 12, fontSize: 12, color: '#6b7280' }}>
                <span>
                  {lookCostPer != null ? (
                    <>Est. <b style={{ color: '#111' }}>${lookCostPer.toFixed(2)}</b> per look
                      {lookCount != null && lookCount > 0 && (
                        <> · ~<b style={{ color: '#111' }}>${(lookCostPer * lookCount).toFixed(2)}</b> across {lookCount.toLocaleString()} generated</>
                      )}
                    </>
                  ) : 'No list price on file for this model'}
                </span>
                <span style={{ fontSize: 11, color: '#999' }}>{lookSaving ? 'Saving…' : 'Saved'}</span>
              </div>
            </div>
          )}
        </div>

        <div className="admin-detail-card">
          <h3>App chrome on scroll</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            Controls the top header (Catalog logo + creators) and the bottom
            search on the home feed. When ON, they stay with you as you scroll
            (default). When OFF, they hide once you scroll past the hero for an
            immersive, media-only feed and glide back at the very top. The feed,
            its product info, and look/product overlays are never affected.
          </p>
          {!chromeOnScrollLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {chromeOnScroll ? 'On' : 'Off'}
                </span>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {chromeOnScroll
                    ? 'Header + search follow the feed on scroll (default).'
                    : 'Header + search hide on scroll — immersive feed; back at the top.'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {chromeOnScrollSaving ? 'Saving…' : 'Saved'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={chromeOnScroll}
                  onClick={() => onToggleChromeOnScroll(!chromeOnScroll)}
                  style={{
                    position: 'relative', width: 44, height: 24, borderRadius: 999,
                    border: 'none', background: chromeOnScroll ? '#16a34a' : '#cbd5e1',
                    cursor: 'pointer', transition: 'background 160ms ease', padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', top: 3, left: chromeOnScroll ? 23 : 3,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      transition: 'left 160ms ease',
                    }}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="admin-detail-card">
          <h3>UI on scroll</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            When ON, the card chrome (creator chip, price, gradient) shows —
            fading out while the feed scrolls and easing back when it settles
            (the media-first feel). When OFF, the chrome is hidden entirely:
            pure imagery, nothing on the cards. Applies to every viewport, live.
          </p>
          {!uiOnScrollLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {uiOnScroll ? 'On' : 'Off'}
                </span>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {uiOnScroll
                    ? 'Chrome shows; fades while scrolling, returns when it settles (default).'
                    : 'Chrome hidden — pure imagery, nothing on the cards.'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {uiOnScrollSaving ? 'Saving…' : 'Saved'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={uiOnScroll}
                  onClick={() => onToggleUiOnScroll(!uiOnScroll)}
                  style={{
                    position: 'relative', width: 44, height: 24, borderRadius: 999,
                    border: 'none', background: uiOnScroll ? '#16a34a' : '#cbd5e1',
                    cursor: 'pointer', transition: 'background 160ms ease', padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', top: 3, left: uiOnScroll ? 23 : 3,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      transition: 'left 160ms ease',
                    }}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="admin-detail-card">
          <h3>Product "More like this" similarity</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            How closely related products must be to appear in the "More
            like this" rail on the product page. Powered by TwelveLabs
            Marengo visual embeddings (cosine similarity). At 0% all
            nearest neighbours from the AI are shown. At 60% the rail
            shows reasonably similar items. At 90% only near-identical
            products pass — the rail may shrink when nothing qualifies.
          </p>
          {!productSimilarityLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={productSimilarity}
                  onChange={e => onSlideProductSimilarity(parseInt(e.target.value, 10))}
                  style={{ flex: 1 }}
                  aria-label="Product similarity threshold percent"
                />
                <div style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {productSimilarity === 0 ? 'Off' : `${productSimilarity}%`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {[0, 50, 60, 70, 80, 90].map(point => (
                  <button
                    key={point}
                    type="button"
                    onClick={() => onSlideProductSimilarity(point)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                      borderRadius: 999,
                      border: `1px solid ${productSimilarity === point ? '#1a1a1a' : '#e5e5e5'}`,
                      background: productSimilarity === point ? '#1a1a1a' : '#fff',
                      color: productSimilarity === point ? '#fff' : '#444',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {point === 0 ? 'Off' : `${point}%`}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#999' }}>
                <span>0% — no filter (show all)</span>
                <span>{productSimilaritySaving ? 'Saving…' : 'Saved'}</span>
                <span>100% — near-identical only</span>
              </div>
              {productSimilarityError && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{productSimilarityError}</div>
              )}
            </>
          )}
        </div>

        <div className="admin-detail-card">
          <h3>Look "More like this" similarity</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            How many of the seed look's products a candidate look must
            share to appear in "More like this". At 0% one shared
            product name is enough (current behaviour). At 60% with a
            3-product look, 2 must match. At 100% every product in the
            seed must appear in the candidate — very strict.
          </p>
          {!lookSimilarityLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={lookSimilarity}
                  onChange={e => onSlideLookSimilarity(parseInt(e.target.value, 10))}
                  style={{ flex: 1 }}
                  aria-label="Look similarity threshold percent"
                />
                <div style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {lookSimilarity === 0 ? 'Off' : `${lookSimilarity}%`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {[0, 25, 50, 75, 100].map(point => (
                  <button
                    key={point}
                    type="button"
                    onClick={() => onSlideLookSimilarity(point)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                      borderRadius: 999,
                      border: `1px solid ${lookSimilarity === point ? '#1a1a1a' : '#e5e5e5'}`,
                      background: lookSimilarity === point ? '#1a1a1a' : '#fff',
                      color: lookSimilarity === point ? '#fff' : '#444',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {point === 0 ? 'Off' : `${point}%`}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#999' }}>
                <span>0% — any 1 match (default)</span>
                <span>{lookSimilaritySaving ? 'Saving…' : 'Saved'}</span>
                <span>100% — all products must match</span>
              </div>
              {lookSimilarityError && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{lookSimilarityError}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

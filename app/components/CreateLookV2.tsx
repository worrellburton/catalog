// CreateLookV2 — guided look-creation flow.
//
// The flow is deliberately linear and one-screen-per-thought:
//
//   1. Empty state. Animates in. One tap target: "Upload media to
//      get started" inside a phone-shaped tile (9:19.5).
//   2. Once the first file lands, the surface switches to a small row
//      of thumbnails pinned in the top third. The user can add up to
//      five photos/videos (each with its own remove button) plus a
//      trailing "+ Add" tile until the cap is reached.
//   3. The first upload is sent to a vision pass that names the
//      products visible in the look. Those render as real product
//      cards in the middle of the screen and the user taps to confirm.
//   4. To add anything the vision pass missed, the user types a query
//      into "Search for a product…" — that fans out to the real
//      product-research service (seed DB + live Google Shopping) and
//      renders tappable result cards. A pasted URL is added as a
//      link-only product instead.
//   5. Preview button at the bottom — disabled until media + at
//      least one product are present. Tapping it expands an inline
//      preview tile that mirrors how the look will show in the feed.
//   6. Publish on the preview surface fires createLook + uploadMedia
//      (every picked file) + addProductToLook + submitLook through the
//      existing edge function and returns the saved look to MyLooks.
//
// In edit mode (`look` prop set), the same surface hydrates with the
// look's existing products and media so the user iterates on top
// instead of routing to a separate editor.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLook, updateLook, addProductToLook, submitLook, uploadLookMedia, type ManagedLook, type AddProductInput } from '~/services/manage-looks';
import { analyzeLookMedia } from '~/services/analyze-look-media';
import { researchProducts, type ResearchedProduct } from '~/services/product-research';
import ParticleBackground from './ParticleBackground';
import VideoTrimmer, { type VideoTrimResult } from './VideoTrimmer';

// ── Picked-media shape ─────────────────────────────────────────────
// Each entry owns its object-URL preview so we can revoke it on
// removal/unmount. `kind` drives whether we render <video> or <img>.
interface MediaItem {
  id: string;
  file: File;
  previewUrl: string;
  kind: 'photo' | 'video';
  /** Trim window (seconds) for videos chosen via the trimmer. */
  trimStart?: number;
  trimEnd?: number;
  /** First-frame poster (JPEG data URL) captured by the trimmer. */
  posterUrl?: string;
}

const MAX_MEDIA = 5;

// ── Detected product shape ─────────────────────────────────────────
// Mirrors AddProductInput so the publish step can pass it through
// without translation. `source` flags where each row came from so we
// can render its card differently (AI-detected vs user-typed vs
// search-result).
interface DetectedProduct {
  id: string;
  brand: string;
  name: string;
  price: string;
  url: string;
  imageUrl: string;
  source: 'ai' | 'manual' | 'search';
  confirmed: boolean;
}

interface Props {
  /** Fires when the look has been saved (created or updated). MyLooks
   *  uses this to dismiss the form and refresh its list. */
  onPublished: (look: ManagedLook) => void;
  /** Fires when the user taps Cancel. */
  onCancel: () => void;
  /** Existing look to edit. When omitted, the form starts blank. */
  look?: ManagedLook | null;
}

type Phase = 'empty' | 'analyzing' | 'review' | 'preview';

// Loose URL sniff — anything starting with http(s):// or looking like
// a bare domain is treated as a pasted link rather than a search query.
function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return true;
  return /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t) && !t.includes(' ');
}

export default function CreateLookV2({ onPublished, onCancel, look: existingLook }: Props) {
  const isEdit = !!existingLook;

  const [phase, setPhase] = useState<Phase>(isEdit ? 'review' : 'empty');
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  // A single picked video opens the trimmer first (in/out + first-frame poster).
  const [trimFile, setTrimFile] = useState<File | null>(null);
  const [products, setProducts] = useState<DetectedProduct[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Product search state (review phase).
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ResearchedProduct[]>([]);
  const [searched, setSearched] = useState(false);

  // Keep a live ref to the picked media so the unmount cleanup can
  // revoke every object URL without re-binding the effect on each add.
  const mediaRef = useRef<MediaItem[]>([]);
  mediaRef.current = mediaItems;

  // Animate-in trigger — sets `mounted=true` on the next frame so
  // the CSS transition picks up the change instead of skipping to
  // the final state on first paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Revoke every outstanding object URL on unmount to avoid leaks.
  useEffect(() => {
    return () => {
      for (const m of mediaRef.current) URL.revokeObjectURL(m.previewUrl);
    };
  }, []);

  // Edit mode: hydrate from the existing look. We map look_products
  // → DetectedProduct (treating them as already-confirmed manual
  // entries) and pull the existing creative video/photo for the
  // preview tile so the user can iterate without re-uploading.
  useEffect(() => {
    if (!existingLook) return;
    const hydrated: DetectedProduct[] = (existingLook.look_products || []).map((lp, idx) => {
      const p = lp.products;
      return {
        id: p?.id || `existing-${idx}`,
        brand: p?.brand || '',
        name: p?.name || '',
        price: p?.price || '',
        url: p?.url || '',
        imageUrl: p?.image_url || '',
        source: 'manual',
        confirmed: true,
      };
    });
    setProducts(hydrated);
  }, [existingLook]);

  // ── Media picking ────────────────────────────────────────────────
  const handlePickMedia = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Append the picked files up to the remaining slots (cap at 5).
  // The first file added kicks off the AI analysis pass.
  const handleMediaFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // A single video opens the trimmer (in/out + first-frame poster) before
    // it's added. Photos (and multi-select) add directly as before.
    if (files.length === 1 && files[0].type.startsWith('video/')) {
      if (mediaRef.current.length < MAX_MEDIA) setTrimFile(files[0]);
      e.target.value = '';
      return;
    }
    let analyzeFile: File | null = null;
    setMediaItems(prev => {
      const remaining = MAX_MEDIA - prev.length;
      if (remaining <= 0) return prev;
      const wasEmpty = prev.length === 0;
      const next: MediaItem[] = [];
      for (let i = 0; i < files.length && next.length < remaining; i++) {
        const file = files[i];
        const kind: 'photo' | 'video' = file.type.startsWith('video/') ? 'video' : 'photo';
        next.push({ id: `m-${Date.now()}-${i}`, file, previewUrl: URL.createObjectURL(file), kind });
      }
      // Only the very first upload triggers analysis.
      if (wasEmpty && next.length > 0) analyzeFile = next[0].file;
      return [...prev, ...next];
    });
    // Reset the input so the same file can be re-picked later.
    e.target.value = '';
    if (analyzeFile) setPhase('analyzing');
  }, []);

  const removeMedia = useCallback((id: string) => {
    setMediaItems(prev => {
      const target = prev.find(m => m.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(m => m.id !== id);
    });
  }, []);

  // Trimmer "Done" → add the video as a media item with its in/out window +
  // first-frame poster. Kicks analysis if it's the first upload.
  const handleTrimConfirm = useCallback((result: VideoTrimResult) => {
    const file = trimFile;
    setTrimFile(null);
    if (!file) return;
    let analyzeFile: File | null = null;
    setMediaItems(prev => {
      if (prev.length >= MAX_MEDIA) return prev;
      const wasEmpty = prev.length === 0;
      if (wasEmpty) analyzeFile = file;
      return [...prev, {
        id: `m-${Date.now()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        kind: 'video',
        trimStart: result.start,
        trimEnd: result.end,
        posterUrl: result.poster || undefined,
      }];
    });
    if (analyzeFile) setPhase('analyzing');
  }, [trimFile]);

  // ── Phase 2 → 3: AI product analysis ─────────────────────────────
  // Calls the analyze-look-media edge function with the first upload.
  // The function runs Claude Vision over a JPEG frame of the file (the
  // file itself for photos, a canvas-sampled frame for videos) and
  // returns a small list of detected wearable items. Empty results are
  // valid ("nothing shoppable seen") — the user can still search for
  // products or paste a link below the cards.
  const runAnalysis = useCallback(async (file: File) => {
    try {
      const detected = await analyzeLookMedia(file);
      const mapped: DetectedProduct[] = detected.map((d, idx) => ({
        id: `ai-${Date.now()}-${idx}`,
        brand: d.brand || '',
        name: d.name,
        price: '',
        url: '',
        imageUrl: '',
        source: 'ai',
        confirmed: false,
      }));
      // Keep any products already attached (edit mode) and append the
      // fresh AI suggestions.
      setProducts(prev => [...prev, ...mapped]);
      setPhase('review');
    } catch (err) {
      // Fall through to an empty review state so the user can keep
      // going — search/link entry stays available.
      console.warn('[CreateLookV2] analyze-look-media failed:', err);
      setError(err instanceof Error ? err.message : 'Could not analyze the media');
      setPhase('review');
    }
  }, []);

  // Kick analysis off whenever we enter the 'analyzing' phase. The
  // first picked file is required — without it there's nothing to
  // analyze.
  useEffect(() => {
    if (phase !== 'analyzing') return;
    const first = mediaItems[0];
    if (!first) return;
    void runAnalysis(first.file);
  }, [phase, mediaItems, runAnalysis]);

  // ── Phase 3: confirm or remove a detected product ────────────────
  const toggleConfirm = useCallback((id: string) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, confirmed: !p.confirmed } : p));
  }, []);

  const removeProduct = useCallback((id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
  }, []);

  // ── Phase 3: add by raw URL (paste-a-link fallback) ──────────────
  // name = the typed text when it isn't itself a URL, otherwise the URL.
  const addByLink = useCallback((raw: string) => {
    const url = raw.trim();
    if (!url) return;
    setProducts(prev => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        brand: '',
        name: url,
        price: '',
        url,
        imageUrl: '',
        source: 'manual',
        confirmed: true,
      },
    ]);
  }, []);

  // ── Phase 3: type-to-find real products ──────────────────────────
  // A pasted URL short-circuits to the link path; anything else runs
  // the product-research service (seed DB + live Google Shopping, with
  // the service's own link fallback) so there are always results.
  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    if (looksLikeUrl(q)) {
      addByLink(q);
      setSearchQuery('');
      return;
    }
    setSearching(true);
    setSearched(true);
    setError(null);
    try {
      const { products: found } = await researchProducts(q);
      setSearchResults(found);
    } catch (err) {
      console.warn('[CreateLookV2] researchProducts failed:', err);
      setSearchResults([]);
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }, [searchQuery, addByLink]);

  // Add a real search result as a confirmed product. Dedupe by
  // brand+name so tapping the same card twice is a no-op.
  const addSearchResult = useCallback((r: ResearchedProduct) => {
    setProducts(prev => {
      const key = `${r.brand}|${r.name}`.toLowerCase();
      if (prev.some(p => `${p.brand}|${p.name}`.toLowerCase() === key)) return prev;
      return [
        ...prev,
        {
          id: `search-${Date.now()}-${prev.length}`,
          brand: r.brand,
          name: r.name,
          price: r.price,
          url: r.url,
          imageUrl: r.image_url,
          source: 'search',
          confirmed: true,
        },
      ];
    });
  }, []);

  // ── Phase 5: ready-to-preview gating ─────────────────────────────
  const confirmedProducts = useMemo(
    () => products.filter(p => p.confirmed),
    [products],
  );
  const canPreview = (mediaItems.length > 0 || isEdit) && confirmedProducts.length > 0;

  // Fallback poster for edit mode when no fresh media was picked.
  const editPoster = useMemo(() => {
    if (!existingLook) return null;
    return existingLook.looks_creative?.[0]?.thumbnail_url
      || existingLook.looks_creative?.[0]?.video_url
      || existingLook.look_photos?.[0]?.url
      || existingLook.look_videos?.[0]?.poster_url
      || null;
  }, [existingLook]);

  // ── Phase 6: publish ─────────────────────────────────────────────
  const handlePublish = useCallback(async () => {
    if (!canPreview) return;
    setPublishing(true);
    setError(null);
    try {
      const title = confirmedProducts[0]?.name?.slice(0, 80) || existingLook?.title || 'New look';
      let look: ManagedLook;
      if (isEdit && existingLook) {
        const { data } = await updateLook(existingLook.id, { title });
        look = data;
      } else {
        const { data } = await createLook({ title, gender: 'unisex' });
        look = data;
      }
      // Upload every picked file, not just the first.
      for (const m of mediaItems) {
        try {
          await uploadLookMedia(look.id, m.file, m.kind);
        } catch (err) {
          console.warn('[CreateLookV2] media upload failed:', err);
        }
      }
      // Only push products that aren't already attached to the look
      // (edit mode keeps the existing ones in place).
      const existingIds = new Set(
        (existingLook?.look_products || [])
          .map(lp => lp.products?.id)
          .filter((v): v is string => !!v),
      );
      const toAttach = confirmedProducts.filter(p => !existingIds.has(p.id));
      await Promise.all(toAttach.map(p => {
        const input: AddProductInput = {
          name: p.name,
          brand: p.brand || undefined,
          price: p.price || undefined,
          url: p.url || undefined,
          image_url: p.imageUrl || undefined,
        };
        return addProductToLook(look.id, input).catch(err => {
          console.warn('[CreateLookV2] addProductToLook failed:', err);
        });
      }));
      const { data: submitted } = await submitLook(look.id);
      onPublished(submitted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [canPreview, confirmedProducts, isEdit, existingLook, mediaItems, onPublished]);

  // The first-paint surface is a particle-only canvas with a small
  // upload card that springs in. Once the user actually picks a file
  // (or we're in edit mode with an existing poster), we shift to the
  // working surface with the thumbnail row + sections below.
  const showHero = phase === 'empty' && mediaItems.length === 0 && !editPoster;

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className={`cl-v2${mounted ? ' is-mounted' : ''}${showHero ? ' is-hero' : ''}`}>
      {trimFile && (
        <VideoTrimmer
          file={trimFile}
          onCancel={() => setTrimFile(null)}
          onConfirm={handleTrimConfirm}
        />
      )}
      {/* Particle field — always on. Sits behind everything; the
          working-surface sections render on top with a slight scrim. */}
      <div className="cl-v2-particles" aria-hidden="true">
        <ParticleBackground />
      </div>

      <header className="cl-v2-head">
        <h2>{isEdit ? 'Edit look' : 'Create a look'}</h2>
        <button type="button" className="cl-v2-close" onClick={onCancel} aria-label="Cancel">×</button>
      </header>

      {showHero ? (
        /* Hero/empty state — small centered upload card that springs
           into view over the particle field. Faded copy underneath
           reads "upload here to get started". This is the first thing
           the user sees on Create a Look. */
        <div className="cl-v2-hero">
          <button
            type="button"
            className="cl-v2-hero-card"
            onClick={handlePickMedia}
            aria-label="Upload media"
          >
            <span className="cl-v2-hero-icon" aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
          </button>
          <span className="cl-v2-hero-label">Upload here to get started</span>
        </div>
      ) : (
        /* Working surface — a small row of media thumbnails pinned in
           the top third. Up to five photos/videos, each removable,
           with a trailing "+ Add" tile until the cap. In edit mode
           with no fresh uploads, the existing poster shows as the
           first thumbnail. */
        <div className="cl-v2-stage">
          <div className="cl-v2-thumb-row">
            {mediaItems.length === 0 && editPoster && (
              <div className="cl-v2-thumb">
                <img src={editPoster} alt="Existing look" />
              </div>
            )}
            {mediaItems.map(m => (
              <div key={m.id} className="cl-v2-thumb">
                {m.kind === 'video' ? (
                  <video src={m.previewUrl} poster={m.posterUrl} muted loop autoPlay playsInline />
                ) : (
                  <img src={m.previewUrl} alt="Uploaded media" />
                )}
                <button
                  type="button"
                  className="cl-v2-thumb-remove"
                  onClick={() => removeMedia(m.id)}
                  aria-label="Remove media"
                >×</button>
              </div>
            ))}
            {mediaItems.length < MAX_MEDIA && (
              <button
                type="button"
                className="cl-v2-thumb cl-v2-thumb-add"
                onClick={handlePickMedia}
                aria-label="Add media"
              >
                <span aria-hidden>+</span>
                <span className="cl-v2-thumb-add-label">Add</span>
              </button>
            )}
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={handleMediaFile}
        style={{ display: 'none' }}
      />

      {/* Phase 2: analyzing state — quick pulse so the user knows
          something is happening without blocking the canvas. */}
      {phase === 'analyzing' && (
        <div className="cl-v2-analyzing">
          <span className="cl-v2-spinner" aria-hidden />
          <span>Finding products in your look…</span>
        </div>
      )}

      {/* Phase 3-4: detected/added products + product search. Only
          renders once we have something to show. */}
      {(phase === 'review' || phase === 'preview') && (
        <section className="cl-v2-products">
          <div className="cl-v2-section-head">
            <h3>{products.length ? 'Tap to confirm' : 'No products yet'}</h3>
            <span className="cl-v2-section-hint">{confirmedProducts.length} confirmed</span>
          </div>

          {products.length > 0 && (
            <div className="cl-v2-card-grid">
              {products.map(p => (
                <div
                  key={p.id}
                  className={`cl-v2-pcard${p.confirmed ? ' is-confirmed' : ''} cl-v2-pcard--${p.source}`}
                >
                  <button
                    type="button"
                    className="cl-v2-pcard-body"
                    onClick={() => toggleConfirm(p.id)}
                    aria-pressed={p.confirmed}
                  >
                    <span className="cl-v2-pcard-media">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" />
                      ) : (
                        <span className="cl-v2-pcard-placeholder">
                          <span className="cl-v2-pcard-badge">Video generated after submit</span>
                        </span>
                      )}
                    </span>
                    <span className="cl-v2-pcard-meta">
                      {p.brand && <span className="cl-v2-pcard-brand">{p.brand}</span>}
                      <span className="cl-v2-pcard-name">{p.name}</span>
                      {p.price && <span className="cl-v2-pcard-price">{p.price}</span>}
                    </span>
                    <span className="cl-v2-pcard-check" aria-hidden>{p.confirmed ? '✓' : '+'}</span>
                  </button>
                  <button
                    type="button"
                    className="cl-v2-pcard-remove"
                    onClick={() => removeProduct(p.id)}
                    aria-label="Remove product"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* Type-to-find real products. Enter or the Go button runs
              the search; a pasted link is added directly instead. */}
          <div className="cl-v2-search">
            <div className="cl-v2-search-row">
              <input
                className="cl-v2-search-input"
                type="text"
                placeholder="Search for a product…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
              />
              <button
                type="button"
                className="cl-v2-search-go"
                onClick={() => void runSearch()}
                disabled={searching || !searchQuery.trim()}
                aria-label="Search"
              >
                {searching ? <span className="cl-v2-spinner" aria-hidden /> : 'Go'}
              </button>
            </div>
            <span className="cl-v2-search-hint">Type a product or brand — or paste a link to add it directly.</span>

            {searching && (
              <div className="cl-v2-analyzing">
                <span className="cl-v2-spinner" aria-hidden />
                <span>Searching…</span>
              </div>
            )}

            {!searching && searched && searchResults.length === 0 && (
              <div className="cl-v2-search-empty">
                No matches — try a brand, or paste a link.
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="cl-v2-result-grid">
                {searchResults.map((r, idx) => {
                  const key = `${r.brand}|${r.name}`.toLowerCase();
                  const added = products.some(p => `${p.brand}|${p.name}`.toLowerCase() === key);
                  return (
                    <button
                      key={`${key}-${idx}`}
                      type="button"
                      className={`cl-v2-result${added ? ' is-added' : ''}`}
                      onClick={() => addSearchResult(r)}
                      disabled={added}
                    >
                      <span className="cl-v2-result-media">
                        {r.image_url ? <img src={r.image_url} alt="" /> : <span className="cl-v2-pcard-placeholder" />}
                      </span>
                      <span className="cl-v2-result-meta">
                        {r.brand && <span className="cl-v2-pcard-brand">{r.brand}</span>}
                        <span className="cl-v2-pcard-name">{r.name}</span>
                        {r.price && <span className="cl-v2-pcard-price">{r.price}</span>}
                      </span>
                      <span className="cl-v2-result-add" aria-hidden>{added ? '✓' : '+'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {error && <div className="cl-v2-error">{error}</div>}

      {/* Phase 5: preview button. Fixed at the bottom so it's always
          a thumb away — disabled until media + at least one
          confirmed product. */}
      {phase !== 'preview' && (phase === 'review' || isEdit) && (
        <div className="cl-v2-footer">
          <button
            type="button"
            className="cl-v2-preview-btn"
            onClick={() => setPhase('preview')}
            disabled={!canPreview}
          >
            Preview
          </button>
        </div>
      )}

      {phase === 'preview' && (
        <section className="cl-v2-preview">
          <h3>Preview</h3>
          <div className="cl-v2-preview-tile">
            {mediaItems[0] ? (
              mediaItems[0].kind === 'video' ? (
                <video src={mediaItems[0].previewUrl} muted loop autoPlay playsInline />
              ) : (
                <img src={mediaItems[0].previewUrl} alt="" />
              )
            ) : editPoster ? (
              <img src={editPoster} alt="" />
            ) : null}
            <div className="cl-v2-preview-products">
              {confirmedProducts.map(p => (
                <div key={p.id} className="cl-v2-preview-product">
                  <span>{p.brand ? `${p.brand} · ${p.name}` : p.name}</span>
                  {p.price && <span className="cl-v2-sample-price">{p.price}</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="cl-v2-publish-row">
            <button type="button" className="cl-v2-back-btn" onClick={() => setPhase('review')}>Back to edit</button>
            <button
              type="button"
              className="cl-v2-publish-btn"
              onClick={handlePublish}
              disabled={publishing}
            >
              {publishing ? (isEdit ? 'Saving…' : 'Publishing…') : (isEdit ? 'Save changes' : 'Publish')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

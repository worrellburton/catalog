// CreateLookV2 — guided look-creation flow.
//
// The flow is deliberately linear and one-screen-per-thought:
//
//   1. Empty state. Animates in. One tap target: "Upload media to
//      get started" inside a phone-shaped tile (9:19.5).
//   2. Once media lands, the same tile fills with the upload.
//   3. The media is sent to a vision pass that names the products
//      visible in the look. We show those as chips in the middle
//      of the screen and the user taps to confirm each one.
//   4. If the chip's product isn't in our catalog, we open a small
//      "describe + paste link" inline form so the user can add it
//      manually.
//   5. Preview button at the bottom — disabled until media + at
//      least one product are present. Tapping it expands an inline
//      preview tile that mirrors how the look will show in the feed.
//   6. Publish on the preview surface fires createLook + uploadMedia
//      + addProductToLook + submitLook through the existing edge
//      function and returns the saved look to MyLooks.
//
// In edit mode (`look` prop set), the same surface hydrates with the
// look's existing products and media so the user iterates on top
// instead of routing to a separate editor.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLook, updateLook, addProductToLook, submitLook, uploadLookMedia, type ManagedLook, type AddProductInput } from '~/services/manage-looks';
import { analyzeLookMedia } from '~/services/analyze-look-media';
import ParticleBackground from './ParticleBackground';

// ── Detected product shape ─────────────────────────────────────────
// Mirrors AddProductInput so the publish step can pass it through
// without translation. `source` flags where each row came from so we
// can render its tile differently (AI-detected vs user-typed).
interface DetectedProduct {
  id: string;
  brand: string;
  name: string;
  price: string;
  url: string;
  imageUrl: string;
  source: 'ai' | 'manual';
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

export default function CreateLookV2({ onPublished, onCancel, look: existingLook }: Props) {
  const isEdit = !!existingLook;

  const [phase, setPhase] = useState<Phase>(isEdit ? 'review' : 'empty');
  const [media, setMedia] = useState<{ file: File; previewUrl: string; kind: 'photo' | 'video' } | null>(null);
  const [products, setProducts] = useState<DetectedProduct[]>([]);
  const [manualDraft, setManualDraft] = useState<{ desc: string; url: string }>({ desc: '', url: '' });
  const [showManualForm, setShowManualForm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Animate-in trigger — sets `mounted=true` on the next frame so
  // the CSS transition picks up the change instead of skipping to
  // the final state on first paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
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

  // ── Phase 1 → 2: media handler ───────────────────────────────────
  const handlePickMedia = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleMediaFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const kind: 'photo' | 'video' = file.type.startsWith('video/') ? 'video' : 'photo';
    const previewUrl = URL.createObjectURL(file);
    setMedia({ file, previewUrl, kind });
    setPhase('analyzing');
  }, []);

  // ── Phase 2 → 3: AI product analysis ─────────────────────────────
  // Today this is a mock that returns a small set of plausible
  // Calls the analyze-look-media edge function with the user's
  // upload. The function runs Claude Vision over a JPEG frame of the
  // file (the file itself for photos, a canvas-sampled frame for
  // videos) and returns a small list of detected wearable items.
  // Empty results are valid ("nothing shoppable seen") — the user can
  // still describe items manually below the chip grid.
  const runAnalysis = useCallback(async (file: File) => {
    try {
      const detected = await analyzeLookMedia(file);
      const mapped: DetectedProduct[] = detected.map((d, idx) => ({
        id: `ai-${Date.now()}-${idx}`,
        brand: d.brand || '',
        // Compose a single readable name: "<color> <name>" if color is
        // distinct from the name's first word; otherwise just the name.
        // The detection prompt already names items specifically, so we
        // mostly keep its phrasing.
        name: d.name,
        price: '',
        url: '',
        imageUrl: '',
        source: 'ai',
        confirmed: false,
      }));
      setProducts(mapped);
      setPhase('review');
    } catch (err) {
      // Fall through to an empty review state so the user can keep
      // going — manual entry stays available.
      console.warn('[CreateLookV2] analyze-look-media failed:', err);
      setError(err instanceof Error ? err.message : 'Could not analyze the media');
      setProducts([]);
      setPhase('review');
    }
  }, []);

  // Kick analysis off whenever we enter the 'analyzing' phase. The
  // current `media` is required — without it there's nothing to analyze.
  useEffect(() => {
    if (phase !== 'analyzing') return;
    if (!media) return;
    void runAnalysis(media.file);
  }, [phase, media, runAnalysis]);

  // ── Phase 3: confirm or remove a detected product ────────────────
  const toggleConfirm = useCallback((id: string) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, confirmed: !p.confirmed } : p));
  }, []);

  const removeProduct = useCallback((id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
  }, []);

  // ── Phase 4: manual entry — when AI missed something ─────────────
  const submitManual = useCallback(() => {
    const { desc, url } = manualDraft;
    if (!desc.trim()) return;
    setProducts(prev => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        brand: '',
        name: desc.trim(),
        price: '',
        url: url.trim(),
        imageUrl: '',
        source: 'manual',
        confirmed: true,
      },
    ]);
    setManualDraft({ desc: '', url: '' });
    setShowManualForm(false);
  }, [manualDraft]);

  // ── Phase 5: ready-to-preview gating ─────────────────────────────
  const confirmedProducts = useMemo(
    () => products.filter(p => p.confirmed),
    [products],
  );
  const canPreview = (!!media || isEdit) && confirmedProducts.length > 0;

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
      if (media) {
        try {
          await uploadLookMedia(look.id, media.file, media.kind);
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
  }, [canPreview, confirmedProducts, isEdit, existingLook, media, onPublished]);

  // Fallback poster for edit mode when no fresh media was picked.
  const editPoster = useMemo(() => {
    if (!existingLook) return null;
    return existingLook.looks_creative?.[0]?.thumbnail_url
      || existingLook.looks_creative?.[0]?.video_url
      || existingLook.look_photos?.[0]?.url
      || existingLook.look_videos?.[0]?.poster_url
      || null;
  }, [existingLook]);

  // The first-paint surface is a particle-only canvas with a small
  // upload card that springs in. Once the user actually picks media
  // (or we're in edit mode with an existing poster), we shift to the
  // working surface with a phone-shaped preview tile + sections below.
  const showHero = phase === 'empty' && !media && !editPoster;

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className={`cl-v2${mounted ? ' is-mounted' : ''}${showHero ? ' is-hero' : ''}`}>
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
        /* Working surface — phone-shaped preview tile, fills with the
           picked file (or the existing look's poster in edit mode). */
        <div className="cl-v2-stage">
          <div
            className={`cl-v2-tile${media ? ' has-media' : ''}`}
            onClick={!media ? handlePickMedia : undefined}
            role={!media ? 'button' : undefined}
            tabIndex={!media ? 0 : undefined}
          >
            {media ? (
              media.kind === 'video' ? (
                <video src={media.previewUrl} muted loop autoPlay playsInline />
              ) : (
                <img src={media.previewUrl} alt="Uploaded media" />
              )
            ) : editPoster ? (
              <img src={editPoster} alt="Existing look" />
            ) : null}

            {media && (
              <button
                type="button"
                className="cl-v2-tile-replace"
                onClick={(e) => { e.stopPropagation(); handlePickMedia(); }}
              >
                Replace
              </button>
            )}
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
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

      {/* Phase 3-4: detected products + manual entry. Only renders
          once we have something to show. */}
      {(phase === 'review' || phase === 'preview') && (
        <section className="cl-v2-products">
          <div className="cl-v2-section-head">
            <h3>{products.length ? 'Tap to confirm' : 'No products yet'}</h3>
            <span className="cl-v2-section-hint">{confirmedProducts.length} confirmed</span>
          </div>

          {products.length > 0 && (
            <div className="cl-v2-chip-grid">
              {products.map(p => (
                <div
                  key={p.id}
                  className={`cl-v2-chip${p.confirmed ? ' is-confirmed' : ''} cl-v2-chip--${p.source}`}
                >
                  <button
                    type="button"
                    className="cl-v2-chip-body"
                    onClick={() => toggleConfirm(p.id)}
                    aria-pressed={p.confirmed}
                  >
                    <span className="cl-v2-chip-name">{p.brand ? `${p.brand} · ${p.name}` : p.name}</span>
                    {p.price && <span className="cl-v2-chip-price">{p.price}</span>}
                    <span className="cl-v2-chip-check" aria-hidden>{p.confirmed ? '✓' : '+'}</span>
                  </button>
                  <button
                    type="button"
                    className="cl-v2-chip-remove"
                    onClick={() => removeProduct(p.id)}
                    aria-label="Remove product"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {!showManualForm ? (
            <button
              type="button"
              className="cl-v2-add-manual"
              onClick={() => setShowManualForm(true)}
            >
              + Add a product we missed
            </button>
          ) : (
            <div className="cl-v2-manual">
              <textarea
                className="cl-v2-manual-desc"
                placeholder="Describe the product (e.g. cream linen camp shirt)"
                value={manualDraft.desc}
                rows={2}
                onChange={(e) => setManualDraft(d => ({ ...d, desc: e.target.value }))}
              />
              <input
                className="cl-v2-manual-link"
                type="url"
                placeholder="Paste a link to it (optional)"
                value={manualDraft.url}
                onChange={(e) => setManualDraft(d => ({ ...d, url: e.target.value }))}
              />
              <div className="cl-v2-manual-row">
                <button
                  type="button"
                  className="cl-v2-back-btn"
                  onClick={() => { setShowManualForm(false); setManualDraft({ desc: '', url: '' }); }}
                >Cancel</button>
                <button
                  type="button"
                  className="cl-v2-publish-btn"
                  onClick={submitManual}
                  disabled={!manualDraft.desc.trim()}
                >Add to look</button>
              </div>
            </div>
          )}
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
            {media ? (
              media.kind === 'video' ? (
                <video src={media.previewUrl} muted loop autoPlay playsInline />
              ) : (
                <img src={media.previewUrl} alt="" />
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

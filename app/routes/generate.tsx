import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import {
  STYLE_PRESETS,
  buildGenerationPrompt,
  createGeneration,
  getGeneration,
  getGenerationDetail,
  listUserGenerations,
  listUserUploads,
  uploadUserPhoto,
  type UserUpload,
  type UserGeneration,
} from '~/services/user-generations';

/* -----------------------------------------------------------
   Generate flow — shopper-facing, multi-step wizard.
   Steps 1–5 cover Photos → Products → Height → Style → Review;
   submit kicks off a generate_look edge function and polls the
   user_generations row until status hits done|failed.
   ----------------------------------------------------------- */

const MAX_PHOTOS = 3;
const MAX_PRODUCTS = 5;

type Step = 'photos' | 'products' | 'height' | 'style' | 'review' | 'result';

interface PickedProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  role_tag: string | null;
}

const ROLE_TAGS = ['Hat', 'Top', 'Jacket', 'Dress', 'Pants', 'Shoes', 'Bag', 'Jewelry', 'Sunglasses', 'Accessory'];

// Height options cover 4'10" – 6'8" in 1" increments; we store the cm value
// on the row and the human label verbatim in the Seedance prompt so the
// model hears "5'10\"" the way the shopper picked it.
const HEIGHT_OPTIONS = (() => {
  const out: { cm: number; label: string }[] = [];
  for (let totalInches = 58; totalInches <= 80; totalInches++) {
    const ft = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    out.push({ cm: Math.round(totalInches * 2.54), label: `${ft}'${inches}"` });
  }
  return out;
})();

function roleTagFromName(name: string | null): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\b(hat|cap|beanie)\b/.test(lower)) return 'Hat';
  if (/\b(sunglass|shades|eyewear)\b/.test(lower)) return 'Sunglasses';
  if (/\b(jacket|coat|parka|blazer)\b/.test(lower)) return 'Jacket';
  if (/\b(dress|gown)\b/.test(lower)) return 'Dress';
  if (/\b(pant|trouser|chino|jean|denim|short|skirt|legging)\b/.test(lower)) return 'Pants';
  if (/\b(sneaker|trainer|shoe|boot|heel|loafer|sandal)\b/.test(lower)) return 'Shoes';
  if (/\b(bag|tote|clutch|purse|backpack)\b/.test(lower)) return 'Bag';
  if (/\b(necklace|ring|earring|bracelet|watch|chain|pendant)\b/.test(lower)) return 'Jewelry';
  if (/\b(shirt|tee|top|sweater|hoodie|polo|henley|tank)\b/.test(lower)) return 'Top';
  return null;
}

export default function GeneratePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<Step>('photos');

  // Photos — fixed 3-slot layout. `slots[i]` is either an upload id (filled)
  // or null (empty). We derive an ordered upload-id list from this for the
  // rest of the wizard + submit payload.
  const [existingUploads, setExistingUploads] = useState<UserUpload[]>([]);
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickedUploadIds = useMemo(
    () => slots.filter((x): x is string => !!x),
    [slots],
  );

  // Past generations — rendered in phase 7 as the "Your looks" grid. We poll
  // pending/generating rows here so the grid promotes itself to done/failed
  // without a page refresh.
  const [generations, setGenerations] = useState<UserGeneration[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Phase 8 — products
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<PickedProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [picked, setPicked] = useState<PickedProduct[]>([]);

  // Phase 9/10 — height + style
  const [heightCm, setHeightCm] = useState<number>(178);  // 5'10" default
  const [heightLabel, setHeightLabel] = useState<string>("5'10\"");
  const [style, setStyle] = useState<string>('street');

  // Phase 12 — submit + poll
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<UserGeneration | null>(null);

  // Load the user's existing uploads once we know who they are, so the
  // dropzone can offer "use a face you already uploaded" instead of
  // forcing a re-upload on every session.
  useEffect(() => {
    if (!user?.id) return;
    listUserUploads(user.id).then(setExistingUploads);
  }, [user?.id]);

  // Initial load of past generations — Phase 7 renders them as cards.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoadingList(true);
    listUserGenerations(user.id).then(rows => {
      if (cancelled) return;
      setGenerations(rows);
      setLoadingList(false);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Poll in-flight list rows every 3s so the grid promotes pending/generating
  // rows as soon as the edge function finishes.
  useEffect(() => {
    const inFlightIds = generations
      .filter(g => g.status === 'pending' || g.status === 'generating')
      .map(g => g.id);
    if (inFlightIds.length === 0) return;
    const handle = window.setInterval(async () => {
      const updates = await Promise.all(inFlightIds.map(id => getGeneration(id)));
      setGenerations(prev => prev.map(g => {
        const fresh = updates.find(u => u?.id === g.id);
        return fresh ?? g;
      }));
    }, 3000);
    return () => window.clearInterval(handle);
  }, [generations]);

  // Phase 8 — search products in the library. Pulls the same active
  // product set the consumer feed uses.
  useEffect(() => {
    if (step !== 'products' || !supabase) return;
    let cancelled = false;
    setProductsLoading(true);
    const q = productQuery.trim();
    const run = async () => {
      let query = supabase!
        .from('products')
        .select('id, name, brand, price, image_url')
        .eq('is_active', true)
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(60);
      if (q) query = query.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
      const { data } = await query;
      if (cancelled) return;
      setProductResults(((data || []) as PickedProduct[]).map(p => ({
        ...p,
        role_tag: roleTagFromName(p.name),
      })));
      setProductsLoading(false);
    };
    const handle = window.setTimeout(run, 180);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [step, productQuery]);

  // Phase 17 — poll the generation row every 2.5s until it lands on a
  // terminal status, so the Result view replaces the spinner as soon as
  // the edge function finishes.
  useEffect(() => {
    if (!generation || generation.status === 'done' || generation.status === 'failed') return;
    const id = window.setInterval(async () => {
      const next = await getGeneration(generation.id);
      if (next) setGeneration(next);
    }, 2500);
    return () => window.clearInterval(id);
  }, [generation]);

  // Tapping an existing upload toggles its membership in the slots — drops
  // it into the first empty slot, or removes it if it's already placed.
  const onPickExistingUpload = (id: string) => {
    setSlots(prev => {
      const idx = prev.indexOf(id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = null;
        return next;
      }
      const empty = prev.indexOf(null);
      if (empty < 0) return prev;
      const next = [...prev];
      next[empty] = id;
      return next;
    });
  };

  // Which slot the next file-picker upload should land in. Tracked via a
  // ref so onFileInput can target a specific slot when the user taps an
  // empty frame, rather than always filling the first empty one.
  const pendingSlotRef = useRef<number | null>(null);

  const openPickerForSlot = (slotIndex: number) => {
    pendingSlotRef.current = slotIndex;
    fileInputRef.current?.click();
  };

  const clearSlot = (slotIndex: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  };

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !user?.id) return;
    const targetSlot = pendingSlotRef.current;
    pendingSlotRef.current = null;

    setUploading(true);
    setUploadError(null);
    const file = files[0];
    const { data, error } = await uploadUserPhoto(file, user.id);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (error) { setUploadError(error); return; }
    if (!data) return;

    setExistingUploads(prev => [data, ...prev]);
    setSlots(prev => {
      const next = [...prev];
      const idx = targetSlot != null && targetSlot >= 0 && targetSlot < MAX_PHOTOS
        ? targetSlot
        : next.indexOf(null);
      if (idx >= 0) next[idx] = data.id;
      return next;
    });
  };

  const togglePick = (p: PickedProduct) => {
    setPicked(prev => {
      if (prev.some(x => x.id === p.id)) return prev.filter(x => x.id !== p.id);
      if (prev.length >= MAX_PRODUCTS) return prev;
      return [...prev, p];
    });
  };

  const setPickedRole = (id: string, role: string | null) => {
    setPicked(prev => prev.map(x => x.id === id ? { ...x, role_tag: role } : x));
  };

  // Open a past generation in the Result view. Used when the shopper taps
  // a card in the "Your looks" grid.
  const openGeneration = (g: UserGeneration) => {
    setGeneration(g);
    setStep('result');
  };

  // Hydrate the wizard from an existing generation and jump to Review so
  // the shopper can tweak + re-submit. A fresh row is created on submit so
  // the history in "Your looks" is preserved.
  const editGeneration = async (id: string) => {
    const detail = await getGenerationDetail(id);
    if (!detail.generation) return;

    const ids = detail.uploadIds.slice(0, MAX_PHOTOS);
    const padded: (string | null)[] = [null, null, null];
    ids.forEach((id, i) => { padded[i] = id; });
    setSlots(padded);

    // Merge any referenced uploads into the library so the review step's
    // thumbnails resolve immediately (they may not be loaded yet).
    if (detail.uploads.length) {
      setExistingUploads(prev => {
        const have = new Set(prev.map(u => u.id));
        const add = detail.uploads.filter(u => !have.has(u.id));
        return add.length ? [...add, ...prev] : prev;
      });
    }

    setPicked(detail.products.map(row => ({
      id: row.product_id,
      name: row.product?.name ?? null,
      brand: row.product?.brand ?? null,
      price: row.product?.price ?? null,
      image_url: row.product?.image_url ?? null,
      role_tag: row.role_tag,
    })));

    if (detail.generation.height_cm) setHeightCm(detail.generation.height_cm);
    if (detail.generation.height_label) setHeightLabel(detail.generation.height_label);
    if (detail.generation.style) setStyle(detail.generation.style);

    setGeneration(null);
    setSubmitError(null);
    setStep('review');
  };

  const startNewLook = () => {
    setGeneration(null);
    setSubmitError(null);
    setPicked([]);
    setStep('photos');
  };

  const canAdvance = useMemo(() => {
    if (step === 'photos') return pickedUploadIds.length > 0 && !uploading;
    if (step === 'products') return picked.length > 0;
    if (step === 'height') return !!heightLabel;
    if (step === 'style') return !!style;
    return true;
  }, [step, pickedUploadIds.length, uploading, picked.length, heightLabel, style]);

  const handleSubmit = async () => {
    if (!user?.id) {
      setSubmitError('Sign in required');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const prompt = buildGenerationPrompt({
      heightLabel,
      style,
      productLines: picked.map(p => ({
        role_tag: p.role_tag,
        brand: p.brand,
        name: p.name,
      })),
    });
    const { data, error } = await createGeneration({
      userId: user.id,
      uploadIds: pickedUploadIds,
      products: picked.map((p, i) => ({ product_id: p.id, role_tag: p.role_tag, sort_order: i })),
      heightCm,
      heightLabel,
      style,
      prompt,
    });
    setSubmitting(false);
    if (error || !data) {
      setSubmitError(error || 'Failed to start generation');
      return;
    }
    setGeneration(data);
    setStep('result');
  };

  if (authLoading) return <div className="gen-page"><div className="gen-empty">Loading…</div></div>;
  if (!user) {
    return (
      <div className="gen-page">
        <div className="gen-empty">
          <h2>Sign in to generate</h2>
          <p>We need your account to save uploads and track your generations.</p>
          <button className="gen-btn-primary" onClick={() => navigate('/')}>Back to catalog</button>
        </div>
      </div>
    );
  }

  return (
    <div className="gen-page">
      <header className="gen-head">
        <button className="gen-back" onClick={() => navigate('/')} aria-label="Back to catalog">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back to catalog
        </button>
        <h1>Generate</h1>
        <p className="gen-sub">Upload a face, pick up to five products, and we'll compose the look.</p>
      </header>

      <StepRail step={step} photosCount={pickedUploadIds.length} productsCount={picked.length} heightLabel={heightLabel} style={style} />

      <main className="gen-main">
        {step === 'photos' && (
          <section className="gen-step">
            <h2>Your reference photos</h2>
            <p>Drop in up to {MAX_PHOTOS} clean face / full-body shots. We'll use them to identify you and then dress you in the products you pick next.</p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              hidden
              onChange={onFileInput}
            />

            <div className="gen-slots">
              {slots.map((uploadId, i) => {
                const upload = uploadId ? existingUploads.find(u => u.id === uploadId) : null;
                return (
                  <div key={i} className={`gen-slot${upload ? ' is-filled' : ''}`}>
                    {upload ? (
                      <>
                        <img src={upload.public_url} alt={`Reference ${i + 1}`} />
                        <button
                          type="button"
                          className="gen-slot-clear"
                          onClick={() => clearSlot(i)}
                          aria-label="Remove photo"
                        >×</button>
                        <button
                          type="button"
                          className="gen-slot-replace"
                          onClick={() => openPickerForSlot(i)}
                        >Replace</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="gen-slot-empty"
                        onClick={() => openPickerForSlot(i)}
                        disabled={uploading}
                      >
                        <span className="gen-slot-plus">+</span>
                        <span className="gen-slot-label">
                          {uploading && pendingSlotRef.current === i ? 'Uploading…' : `Photo ${i + 1}`}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {uploadError && <div className="gen-error">{uploadError}</div>}

            <button
              type="button"
              className="gen-btn-primary gen-create-btn"
              disabled={!canAdvance}
              onClick={() => goNext(step, setStep)}
            >
              Create look
            </button>

            {existingUploads.length > 0 && (
              <>
                <div className="gen-sectionlabel">Your uploads</div>
                <div className="gen-thumbgrid">
                  {existingUploads.map(u => (
                    <button
                      key={u.id}
                      className={`gen-thumb${pickedUploadIds.includes(u.id) ? ' is-picked' : ''}`}
                      onClick={() => onPickExistingUpload(u.id)}
                      type="button"
                    >
                      <img src={u.public_url} alt="" />
                      {pickedUploadIds.includes(u.id) && <span className="gen-thumb-check">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}

            {(generations.length > 0 || loadingList) && (
              <>
                <div className="gen-sectionlabel">Your looks</div>
                {loadingList && generations.length === 0 ? (
                  <div className="gen-empty">Loading your looks…</div>
                ) : (
                  <div className="gen-lookgrid">
                    {generations.map(g => (
                      <LookCard
                        key={g.id}
                        generation={g}
                        onOpen={() => openGeneration(g)}
                        onRegenerate={() => editGeneration(g.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {step === 'products' && (
          <section className="gen-step">
            <h2>2. Pick up to {MAX_PRODUCTS} products</h2>
            <input
              type="search"
              className="gen-search"
              placeholder="Search by name or brand…"
              value={productQuery}
              onChange={e => setProductQuery(e.target.value)}
            />
            {picked.length > 0 && (
              <div className="gen-picked">
                {picked.map(p => (
                  <div key={p.id} className="gen-picked-chip">
                    {p.image_url && <img src={p.image_url} alt="" />}
                    <div className="gen-picked-chip-info">
                      <span className="gen-picked-chip-name">{p.name || 'Product'}</span>
                      <select
                        value={p.role_tag || ''}
                        onChange={e => setPickedRole(p.id, e.target.value || null)}
                        aria-label="Role"
                      >
                        <option value="">Auto</option>
                        {ROLE_TAGS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <button className="gen-picked-chip-x" onClick={() => togglePick(p)} aria-label="Remove">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="gen-productgrid">
              {productsLoading && productResults.length === 0 ? (
                <div className="gen-empty">Loading products…</div>
              ) : productResults.length === 0 ? (
                <div className="gen-empty">No products match "{productQuery}"</div>
              ) : (
                productResults.map(p => {
                  const isPicked = picked.some(x => x.id === p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`gen-productcard${isPicked ? ' is-picked' : ''}`}
                      onClick={() => togglePick(p)}
                      disabled={!isPicked && picked.length >= MAX_PRODUCTS}
                    >
                      {p.image_url && <img src={p.image_url} alt="" />}
                      <span className="gen-productcard-name">{p.name || 'Product'}</span>
                      <span className="gen-productcard-brand">{p.brand}</span>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {step === 'height' && (
          <section className="gen-step">
            <h2>3. Your height</h2>
            <p>Seedance will render proportions from this — we pass the value verbatim into the prompt.</p>
            <div className="gen-heightgrid">
              {HEIGHT_OPTIONS.map(opt => (
                <button
                  key={opt.cm}
                  type="button"
                  className={`gen-heightchip${heightLabel === opt.label ? ' is-picked' : ''}`}
                  onClick={() => { setHeightCm(opt.cm); setHeightLabel(opt.label); }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'style' && (
          <section className="gen-step">
            <h2>4. Style</h2>
            <div className="gen-stylegrid">
              {STYLE_PRESETS.map(s => (
                <button
                  key={s.value}
                  type="button"
                  className={`gen-stylecard${style === s.value ? ' is-picked' : ''}`}
                  onClick={() => setStyle(s.value)}
                >
                  <span className="gen-stylecard-label">{s.label}</span>
                  <span className="gen-stylecard-blurb">{s.blurb}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'review' && (
          <section className="gen-step">
            <h2>5. Review</h2>
            <div className="gen-review">
              <div className="gen-review-row"><span>Photos</span><span>{pickedUploadIds.length}</span></div>
              <div className="gen-review-row"><span>Products</span><span>{picked.length}</span></div>
              <div className="gen-review-row"><span>Height</span><span>{heightLabel}</span></div>
              <div className="gen-review-row"><span>Style</span><span>{STYLE_PRESETS.find(s => s.value === style)?.label || style}</span></div>
            </div>
            <div className="gen-review-products">
              {picked.map(p => (
                <div key={p.id} className="gen-review-product">
                  {p.image_url && <img src={p.image_url} alt="" />}
                  <div>
                    <div className="gen-review-product-name">{p.name}</div>
                    <div className="gen-review-product-role">{p.role_tag || 'Auto'}</div>
                  </div>
                </div>
              ))}
            </div>
            {submitError && <div className="gen-error">{submitError}</div>}
          </section>
        )}

        {step === 'result' && (
          <section className="gen-step">
            <h2>Your look</h2>
            {!generation && <div className="gen-empty">Loading…</div>}
            {generation?.status === 'pending' && (
              <div className="gen-spinner">
                Queued — starting Catalog <span className="gen-vision">Vision</span>…
              </div>
            )}
            {generation?.status === 'generating' && <div className="gen-spinner">Generating — this takes ~60s…</div>}
            {generation?.status === 'failed' && (
              <div className="gen-error">
                Generation failed: {generation.error || 'Unknown error'}
              </div>
            )}
            {generation?.status === 'done' && generation.video_url && (
              <video src={generation.video_url} autoPlay loop muted playsInline className="gen-result-video" />
            )}
            {generation && (
              <div className="gen-result-actions">
                <button className="gen-btn-secondary" onClick={startNewLook}>
                  New look
                </button>
                <button
                  className="gen-btn-primary"
                  onClick={() => editGeneration(generation.id)}
                >
                  Edit &amp; regenerate
                </button>
              </div>
            )}
          </section>
        )}
      </main>

      {step !== 'result' && step !== 'photos' && (
        <footer className="gen-foot">
          <button className="gen-btn-secondary" onClick={() => goPrev(step, setStep)}>
            Back
          </button>
          {step === 'review' ? (
            <button className="gen-btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Starting…' : 'Generate look'}
            </button>
          ) : (
            <button className="gen-btn-primary" disabled={!canAdvance} onClick={() => goNext(step, setStep)}>
              Next
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

const STEP_ORDER: Step[] = ['photos', 'products', 'height', 'style', 'review'];

function goNext(current: Step, set: (s: Step) => void) {
  const i = STEP_ORDER.indexOf(current);
  if (i >= 0 && i < STEP_ORDER.length - 1) set(STEP_ORDER[i + 1]);
}
function goPrev(current: Step, set: (s: Step) => void) {
  const i = STEP_ORDER.indexOf(current);
  if (i > 0) set(STEP_ORDER[i - 1]);
}

function LookCard({
  generation,
  onOpen,
  onRegenerate,
}: {
  generation: UserGeneration;
  onOpen: () => void;
  onRegenerate: () => void;
}) {
  const style = STYLE_PRESETS.find(s => s.value === generation.style);
  const isDone = generation.status === 'done' && generation.video_url;
  const isFailed = generation.status === 'failed';
  const isBusy = generation.status === 'pending' || generation.status === 'generating';

  return (
    <div className="gen-lookcard">
      <button type="button" className="gen-lookcard-media" onClick={onOpen}>
        {isDone && generation.video_url ? (
          <video src={generation.video_url} muted playsInline preload="metadata" />
        ) : (
          <div className={`gen-lookcard-placeholder${isFailed ? ' is-failed' : ''}`}>
            {isBusy ? (
              <span className="gen-vision">Vision</span>
            ) : isFailed ? (
              <span>Failed</span>
            ) : null}
          </div>
        )}
        {isBusy && <span className="gen-lookcard-chip">{generation.status === 'pending' ? 'Queued' : 'Generating'}</span>}
      </button>
      <div className="gen-lookcard-foot">
        <span className="gen-lookcard-label">{style?.label || generation.style}</span>
        <button
          type="button"
          className="gen-lookcard-regen"
          onClick={onRegenerate}
          aria-label="Edit and regenerate"
          title="Edit & regenerate"
        >↻</button>
      </div>
    </div>
  );
}

function StepRail({
  step, photosCount, productsCount, heightLabel, style,
}: {
  step: Step;
  photosCount: number;
  productsCount: number;
  heightLabel: string;
  style: string;
}) {
  const items: { k: Step; label: string; value: string }[] = [
    { k: 'photos',   label: 'Photos',   value: photosCount ? `${photosCount} picked` : '—' },
    { k: 'products', label: 'Products', value: productsCount ? `${productsCount} picked` : '—' },
    { k: 'height',   label: 'Height',   value: heightLabel || '—' },
    { k: 'style',    label: 'Style',    value: STYLE_PRESETS.find(s => s.value === style)?.label || style || '—' },
    { k: 'review',   label: 'Review',   value: '—' },
  ];
  const activeIdx = STEP_ORDER.indexOf(step);
  return (
    <nav className="gen-rail" aria-label="Generate steps">
      {items.map((item, i) => (
        <div key={item.k} className={`gen-rail-item${i === activeIdx ? ' is-active' : ''}${i < activeIdx ? ' is-done' : ''}`}>
          <span className="gen-rail-num">{i + 1}</span>
          <span className="gen-rail-label">{item.label}</span>
          <span className="gen-rail-value">{item.value}</span>
        </div>
      ))}
    </nav>
  );
}

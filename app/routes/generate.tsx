import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import {
  STYLE_PRESETS,
  buildGenerationPrompt,
  createGeneration,
  getGeneration,
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

  // Phase 7 — photos
  const [existingUploads, setExistingUploads] = useState<UserUpload[]>([]);
  const [pickedUploadIds, setPickedUploadIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const onPickExistingUpload = (id: string) => {
    setPickedUploadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PHOTOS) next.add(id);
      return next;
    });
  };

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !user?.id) return;
    setUploading(true);
    setUploadError(null);
    const fresh: UserUpload[] = [];
    for (const file of files.slice(0, MAX_PHOTOS - pickedUploadIds.size)) {
      const { data, error } = await uploadUserPhoto(file, user.id);
      if (error) { setUploadError(error); break; }
      if (data) fresh.push(data);
    }
    if (fresh.length) {
      setExistingUploads(prev => [...fresh, ...prev]);
      setPickedUploadIds(prev => {
        const next = new Set(prev);
        fresh.forEach(u => { if (next.size < MAX_PHOTOS) next.add(u.id); });
        return next;
      });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  const canAdvance = useMemo(() => {
    if (step === 'photos') return pickedUploadIds.size > 0 && !uploading;
    if (step === 'products') return picked.length > 0;
    if (step === 'height') return !!heightLabel;
    if (step === 'style') return !!style;
    return true;
  }, [step, pickedUploadIds.size, uploading, picked.length, heightLabel, style]);

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
      uploadIds: Array.from(pickedUploadIds),
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

      <StepRail step={step} photosCount={pickedUploadIds.size} productsCount={picked.length} heightLabel={heightLabel} style={style} />

      <main className="gen-main">
        {step === 'photos' && (
          <section className="gen-step">
            <h2>1. Your photos</h2>
            <p>Drop in {MAX_PHOTOS} clean face / full-body references — we'll keep the face intact and dress you in the products.</p>

            <div className="gen-dropzone" onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden onChange={onFileInput} />
              <div className="gen-dropzone-icon">↑</div>
              <div className="gen-dropzone-text">
                {uploading ? 'Uploading…' : `Tap to upload (up to ${MAX_PHOTOS - pickedUploadIds.size} more)`}
              </div>
              {uploadError && <div className="gen-error">{uploadError}</div>}
            </div>

            {existingUploads.length > 0 && (
              <>
                <div className="gen-sectionlabel">Your uploads</div>
                <div className="gen-thumbgrid">
                  {existingUploads.map(u => (
                    <button
                      key={u.id}
                      className={`gen-thumb${pickedUploadIds.has(u.id) ? ' is-picked' : ''}`}
                      onClick={() => onPickExistingUpload(u.id)}
                      type="button"
                    >
                      <img src={u.public_url} alt="" />
                      {pickedUploadIds.has(u.id) && <span className="gen-thumb-check">✓</span>}
                    </button>
                  ))}
                </div>
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
              <div className="gen-review-row"><span>Photos</span><span>{pickedUploadIds.size}</span></div>
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
          </section>
        )}
      </main>

      {step !== 'result' && (
        <footer className="gen-foot">
          {step !== 'photos' && (
            <button className="gen-btn-secondary" onClick={() => goPrev(step, setStep)}>
              Back
            </button>
          )}
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

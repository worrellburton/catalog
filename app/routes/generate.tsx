import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import {
  STYLE_PRESETS,
  buildGenerationPrompt,
  createGeneration,
  deleteUserGeneration,
  deleteUserUpload,
  getGeneration,
  getGenerationDetail,
  getUserSlots,
  listUserGenerations,
  listUserUploads,
  saveUserSlots,
  uploadUserPhoto,
  type UserUpload,
  type UserGeneration,
  type GenerationProductDetail,
} from '~/services/user-generations';

/* -----------------------------------------------------------
   Generate flow — shopper-facing, multi-step wizard.
   Steps 1–5 cover Photos → Products → Height → Style → Review;
   submit kicks off a generate_look edge function and polls the
   user_generations row until status hits done|failed.
   ----------------------------------------------------------- */

const MAX_PHOTOS = 3;
const MAX_PRODUCTS = 5;

// Seedance 2 reference-to-video with multiple references runs longer
// than v1: latest data shows ~166s on the only success and ~180s+ on
// runs that timed out client-side. We now use Fal webhooks (no
// internal poller cap), so budget 180s for the user-facing progress
// bar; it eases past 95% so it never sits flat on slow jobs.
const TYPICAL_GENERATION_SECONDS = 180;

type Step = 'photos' | 'products' | 'about' | 'style' | 'review' | 'result';

// Age presets keep the picker compact — Seedance just needs a phrase
// to seed how old the subject reads. Defaults to "mid 20s".
const AGE_PRESETS: { label: string }[] = [
  { label: 'late teens' },
  { label: 'early 20s' },
  { label: 'mid 20s' },
  { label: 'late 20s' },
  { label: 'early 30s' },
  { label: 'mid 30s' },
  { label: 'early 40s' },
  { label: '50s' },
  { label: '60s+' },
];

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
  // Per-slot upload state. `slot` survives the whole upload (a separate
  // ref was being cleared synchronously, so the old "Uploading…" label
  // never showed); `pct` is the byte-level progress reported by the XHR
  // upload.onprogress event.
  const [uploadProgress, setUploadProgress] = useState<{ slot: number; pct: number } | null>(null);
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
  const [ageLabel, setAgeLabel] = useState<string>('mid 20s');
  const [style, setStyle] = useState<string>('street');

  // Phase 12 — submit + poll
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<UserGeneration | null>(null);
  // Products + reference uploads tied to the currently-viewed generation.
  // Hydrated whenever we land on the result step so the look surfaces the
  // outfit it was built from (not just the video).
  const [resultProducts, setResultProducts] = useState<GenerationProductDetail[]>([]);
  const [resultRefs, setResultRefs] = useState<UserUpload[]>([]);
  useEffect(() => {
    if (step !== 'result' || !generation?.id) {
      setResultProducts([]); setResultRefs([]); return;
    }
    let cancelled = false;
    getGenerationDetail(generation.id).then(d => {
      if (cancelled) return;
      setResultProducts(d.products);
      setResultRefs(d.uploads);
    });
    return () => { cancelled = true; };
  }, [generation?.id, step]);

  // Load the user's existing uploads once we know who they are, so the
  // dropzone can offer "use a face you already uploaded" instead of
  // forcing a re-upload on every session. We also fetch the saved
  // slot picks from Supabase in parallel so the shopper's previously-
  // chosen reference photos roam across devices (filtered against
  // what still exists, in case any were deleted).
  const slotsHydrated = useRef(false);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    Promise.all([
      listUserUploads(user.id),
      getUserSlots(user.id, MAX_PHOTOS),
    ]).then(([uploads, savedSlots]) => {
      if (cancelled) return;
      setExistingUploads(uploads);
      const known = new Set(uploads.map(u => u.id));
      const restored: (string | null)[] = [null, null, null];
      savedSlots.slice(0, MAX_PHOTOS).forEach((id, i) => {
        if (typeof id === 'string' && known.has(id)) restored[i] = id;
      });
      setSlots(restored);
      slotsHydrated.current = true;
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Persist slot changes back to Supabase so they survive across
  // sessions and devices. Skipped until after the initial hydrate so
  // we don't overwrite the saved row with the empty `[null,null,null]`
  // default before we've had a chance to read it.
  useEffect(() => {
    if (!user?.id || !slotsHydrated.current) return;
    saveUserSlots(user.id, slots);
  }, [user?.id, slots]);

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

  // Place a specific upload into a specific slot — used by the picker
  // modal so the choice always lands in the slot the user tapped, even
  // if it was already filled.
  const placeUploadInSlot = (slotIndex: number, uploadId: string) => {
    setSlots(prev => {
      const next = [...prev];
      // If this upload is already in another slot, vacate it so we
      // never end up with the same id in two slots at once.
      const existing = next.indexOf(uploadId);
      if (existing >= 0 && existing !== slotIndex) next[existing] = null;
      next[slotIndex] = uploadId;
      return next;
    });
  };

  const removeUpload = async (upload: UserUpload) => {
    setExistingUploads(prev => prev.filter(u => u.id !== upload.id));
    setSlots(prev => prev.map(id => id === upload.id ? null : id));
    const { error } = await deleteUserUpload(upload);
    if (error) setUploadError(error);
  };

  const removeGeneration = async (id: string) => {
    setGenerations(prev => prev.filter(g => g.id !== id));
    await deleteUserGeneration(id);
  };

  // Which slot the next file-picker upload should land in. Tracked via a
  // ref so onFileInput can target a specific slot when the user taps an
  // empty frame, rather than always filling the first empty one.
  const pendingSlotRef = useRef<number | null>(null);

  // Slot the upload-picker modal is currently choosing for. `null` =
  // closed. When non-null, clicking a thumbnail in the modal places it
  // into this slot (instead of the first empty slot).
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  const openPickerForSlot = (slotIndex: number) => {
    // If the user has any existing uploads, prefer the modal so they can
    // pick from history (and delete) rather than re-uploading. Empty
    // history → straight to the file picker.
    if (existingUploads.length > 0) {
      setPickerSlot(slotIndex);
      return;
    }
    pendingSlotRef.current = slotIndex;
    fileInputRef.current?.click();
  };

  const openFileChooserFromModal = () => {
    pendingSlotRef.current = pickerSlot;
    setPickerSlot(null);
    fileInputRef.current?.click();
  };

  const clearSlot = (slotIndex: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  };

  // Slots currently rendering a "drag is hovering me" outline. We
  // track them as a Set since multiple drag events fire across nested
  // children, and using counter math gets ugly.
  const [dragSlots, setDragSlots] = useState<Set<number>>(new Set());

  // Shared core upload pipeline — used by both the file picker
  // (`onFileInput`) and the slot drop handler. `targetSlot` is the
  // slot the upload should land in; pass `null` to fall back to the
  // first empty slot.
  const uploadFileIntoSlot = async (file: File, targetSlot: number | null) => {
    if (!user?.id) return;
    setUploading(true);
    setUploadError(null);
    const slotForProgress = targetSlot != null && targetSlot >= 0 && targetSlot < MAX_PHOTOS
      ? targetSlot
      : slots.indexOf(null);
    if (slotForProgress >= 0) setUploadProgress({ slot: slotForProgress, pct: 0 });
    const { data, error } = await uploadUserPhoto(file, user.id, (pct) => {
      setUploadProgress(prev => prev?.slot === slotForProgress
        ? { slot: slotForProgress, pct }
        : prev);
    });
    setUploading(false);
    setUploadProgress(null);
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

  const onSlotDrop = (slotIndex: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragSlots(prev => { const next = new Set(prev); next.delete(slotIndex); return next; });
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (!file) return;
    uploadFileIntoSlot(file, slotIndex);
  };

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const targetSlot = pendingSlotRef.current;
    pendingSlotRef.current = null;
    await uploadFileIntoSlot(files[0], targetSlot);
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
    if (detail.generation.age_label) setAgeLabel(detail.generation.age_label);
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
    if (step === 'about') return !!heightLabel && !!ageLabel;
    if (step === 'style') return !!style;
    return true;
  }, [step, pickedUploadIds.length, uploading, picked.length, heightLabel, ageLabel, style]);

  const handleSubmit = async () => {
    if (!user?.id) {
      setSubmitError('Sign in required');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const prompt = buildGenerationPrompt({
      heightLabel,
      ageLabel,
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
      ageLabel,
      style,
      prompt,
    });
    setSubmitting(false);
    if (error || !data) {
      setSubmitError(error || 'Failed to start generation');
      return;
    }
    setGeneration(data);
    // Prepend the new row to the in-memory list so it shows up in
    // "Your looks" the moment the shopper hits Back from the result
    // screen — no page refresh needed. The list-polling effect will
    // promote it through generating -> done|failed in place.
    setGenerations(prev => [data, ...prev.filter(g => g.id !== data.id)]);
    setStep('result');
  };

  if (authLoading) return <div className="gen-page"><div className="gen-empty">Loading…</div></div>;
  if (!user) {
    return (
      <div className="gen-page">
        <div className="gen-empty">
          <h2>Sign in to generate</h2>
          <p>We need your account to save uploads and track your generations.</p>
          <button className="gen-btn-primary" onClick={() => navigate('/#app')}>Back to catalog</button>
        </div>
      </div>
    );
  }

  return (
    <div className="gen-page">
      <div className="gen-head">
        <button
          className="gen-back"
          onClick={() => {
            // From the result view, "back" should land the shopper on
            // the Photos step (with their looks grid) rather than
            // bouncing them all the way out to the catalog.
            if (step === 'result') {
              setStep('photos');
              return;
            }
            navigate('/#app');
          }}
          aria-label={step === 'result' ? 'Back to your looks' : 'Back to catalog'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          {step === 'result' ? 'Back to your looks' : 'Back to catalog'}
        </button>
        <h1>Generate</h1>
        <p className="gen-sub">Upload a face, pick up to five products, and we'll compose the look.</p>
      </div>

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
                const isUploadingHere = uploadProgress?.slot === i;
                const pctHere = isUploadingHere ? Math.round(uploadProgress!.pct * 100) : 0;
                const isDragging = dragSlots.has(i);
                return (
                  <div
                    key={i}
                    className={`gen-slot${upload ? ' is-filled' : ''}${isUploadingHere ? ' is-uploading' : ''}${isDragging ? ' is-dragover' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setDragSlots(prev => new Set(prev).add(i));
                    }}
                    onDragLeave={(e) => {
                      // Ignore enter/leave bubbling between children — only
                      // clear the highlight when we actually leave the slot.
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                      setDragSlots(prev => { const next = new Set(prev); next.delete(i); return next; });
                    }}
                    onDrop={(e) => onSlotDrop(i, e)}
                  >
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
                    ) : isUploadingHere ? (
                      <div className="gen-slot-uploading">
                        <div className="gen-slot-uploading-pct">{pctHere}%</div>
                        <div className="gen-slot-uploading-track">
                          <div className="gen-slot-uploading-fill" style={{ width: `${pctHere}%` }} />
                        </div>
                        <div className="gen-slot-uploading-label">
                          {pctHere >= 100 ? 'Saving…' : 'Uploading'}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="gen-slot-empty"
                        onClick={() => openPickerForSlot(i)}
                        disabled={uploading}
                      >
                        <span className="gen-slot-plus">+</span>
                        <span className="gen-slot-label">Photo {i + 1}</span>
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
                        onDelete={() => removeGeneration(g.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {pickerSlot !== null && (
          <UploadPickerModal
            slot={pickerSlot}
            uploads={existingUploads}
            pickedIds={pickedUploadIds}
            currentSlotId={slots[pickerSlot]}
            onClose={() => setPickerSlot(null)}
            onPick={(id) => { placeUploadInSlot(pickerSlot, id); setPickerSlot(null); }}
            onDelete={removeUpload}
            onUploadNew={openFileChooserFromModal}
          />
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

        {step === 'about' && (
          <section className="gen-step">
            <h2>3. About you</h2>
            <p>Pick a height and an age range. We pass both into the prompt so the proportions and look land where you want them.</p>

            <div className="gen-aboutgroup">
              <div className="gen-sectionlabel">Height</div>
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
            </div>

            <div className="gen-aboutgroup">
              <div className="gen-sectionlabel">Age</div>
              <div className="gen-heightgrid">
                {AGE_PRESETS.map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    className={`gen-heightchip${ageLabel === opt.label ? ' is-picked' : ''}`}
                    onClick={() => setAgeLabel(opt.label)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
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
              <div className="gen-review-row"><span>Age</span><span>{ageLabel}</span></div>
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
          <section className="gen-step gen-step-result">
            <h2>Your look</h2>
            {!generation && <div className="gen-empty">Loading…</div>}
            {(generation?.status === 'pending' || generation?.status === 'generating') && (
              <GenerationProgress generation={generation} />
            )}
            {generation?.status === 'failed' && (
              <div className="gen-error">
                Generation failed: {generation.error || 'Unknown error'}
              </div>
            )}
            {generation?.status === 'done' && generation.video_url && (
              <div className="gen-build gen-build-done">
                <div className="gen-build-burst" aria-hidden="true" />
                <div className="gen-build-burst gen-build-burst-2" aria-hidden="true" />
                <div className="gen-build-frame is-done">
                  <video src={generation.video_url} autoPlay loop muted playsInline className="gen-result-video" />
                </div>
              </div>
            )}
            {generation?.status === 'done' && resultProducts.length > 0 && (
              <div className="gen-result-products">
                <div className="gen-result-products-label">Products in this look</div>
                <ul className="gen-result-products-list">
                  {resultProducts.map(p => (
                    <li key={p.product_id} className="gen-result-product">
                      {p.product?.image_url ? (
                        <img src={p.product.image_url} alt="" className="gen-result-product-img" />
                      ) : (
                        <div className="gen-result-product-img gen-result-product-img-empty" />
                      )}
                      <div className="gen-result-product-text">
                        {p.role_tag && <span className="gen-result-product-role">{p.role_tag}</span>}
                        <span className="gen-result-product-name">
                          {[p.product?.brand, p.product?.name].filter(Boolean).join(' — ') || 'Product'}
                        </span>
                        {p.product?.price && <span className="gen-result-product-price">{p.product.price}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
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

      {step !== 'result' && step !== 'photos' && (
        <StepRail step={step} photosCount={pickedUploadIds.length} productsCount={picked.length} heightLabel={heightLabel} ageLabel={ageLabel} style={style} />
      )}
    </div>
  );
}

const STEP_ORDER: Step[] = ['photos', 'products', 'about', 'style', 'review'];

function goNext(current: Step, set: (s: Step) => void) {
  const i = STEP_ORDER.indexOf(current);
  if (i >= 0 && i < STEP_ORDER.length - 1) set(STEP_ORDER[i + 1]);
}
function goPrev(current: Step, set: (s: Step) => void) {
  const i = STEP_ORDER.indexOf(current);
  if (i > 0) set(STEP_ORDER[i - 1]);
}

// Ten labelled phases the build pass flows through. They're cosmetic —
// Fal doesn't expose stage progress — but the gradual reveal builds
// anticipation and gives the wait a sense of motion. Each phase owns
// 10% of the typical budget; we mark prior phases as done as we cross
// the boundary into the next one.
const BUILD_PHASES = [
  'Queueing your look',
  'Reading reference photos',
  'Mapping facial features',
  'Locking in proportions',
  'Pulling product details',
  'Composing the outfit',
  'Lighting the scene',
  'Rendering motion frames',
  'Color grading',
  'Final pass',
];

function GenerationProgress({ generation }: { generation: UserGeneration }) {
  // Tick four times a second so the border-progress + phase rotation
  // feel alive between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const startedAt = useMemo(() => new Date(generation.created_at).getTime(), [generation.created_at]);
  const elapsedSec = Math.max(0, (Date.now() - startedAt) / 1000);
  // Linear up to 95% across the typical budget; soft asymptote past that
  // so users never see a static 100% bar while we're still polling Fal.
  const linearPct = (elapsedSec / TYPICAL_GENERATION_SECONDS) * 95;
  const overflowPct = elapsedSec > TYPICAL_GENERATION_SECONDS
    ? 95 + (1 - Math.exp(-(elapsedSec - TYPICAL_GENERATION_SECONDS) / 60)) * 4.5
    : linearPct;
  const pct = Math.min(99.5, Math.max(2, overflowPct));

  // Phase index — 0..9. We pace it slightly behind raw % so the
  // current label feels like it's still working when the bar is at
  // its boundary, instead of jumping ahead instantly.
  const phaseIdx = Math.min(
    BUILD_PHASES.length - 1,
    Math.floor((pct / 100) * BUILD_PHASES.length),
  );
  const activePhase = BUILD_PHASES[phaseIdx];

  const remaining = Math.max(0, Math.round(TYPICAL_GENERATION_SECONDS - elapsedSec));
  const subLabel = remaining > 0
    ? `About ${remaining}s left`
    : 'Almost there…';

  return (
    <div className="gen-build">
      <div
        className="gen-build-frame is-building"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`Generating — ${activePhase}`}
      >
        {/* Border progress: stroke a single rect along its perimeter
            using `pathLength="100"` so the dasharray maps cleanly to
            percent. preserveAspectRatio="none" lets the stroke trace
            the 9:16 frame regardless of its rendered size. */}
        <svg className="gen-build-border" viewBox="0 0 90 160" preserveAspectRatio="none" aria-hidden="true">
          <rect className="gen-build-track" x="1" y="1" width="88" height="158" rx="6" ry="6" pathLength={100} />
          <rect
            className="gen-build-fill"
            x="1" y="1" width="88" height="158" rx="6" ry="6"
            pathLength={100}
            strokeDasharray={`${pct} 100`}
          />
        </svg>

        <div className="gen-build-shimmer" aria-hidden="true" />
        <div className="gen-build-pulse" aria-hidden="true" />

        <div className="gen-build-content">
          <span className="gen-vision gen-build-vision">Vision</span>
          <div className="gen-build-phase">{activePhase}</div>
          <div className="gen-build-sub">{subLabel}</div>
          <div className="gen-build-pct">{Math.round(pct)}%</div>
        </div>
      </div>

    </div>
  );
}

function LookCard({
  generation,
  onOpen,
  onRegenerate,
  onDelete,
}: {
  generation: UserGeneration;
  onOpen: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const style = STYLE_PRESETS.find(s => s.value === generation.style);
  const isDone = generation.status === 'done' && generation.video_url;
  const isFailed = generation.status === 'failed';
  const isBusy = generation.status === 'pending' || generation.status === 'generating';

  // Tick once a second while the row is in flight so the mini border
  // progress + phase label stay live on the grid card. We only run
  // the timer for busy items so done/failed cards stay still.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isBusy) return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isBusy]);

  const startedAt = useMemo(() => new Date(generation.created_at).getTime(), [generation.created_at]);
  const elapsedSec = Math.max(0, (Date.now() - startedAt) / 1000);
  const linearPct = (elapsedSec / TYPICAL_GENERATION_SECONDS) * 95;
  const overflowPct = elapsedSec > TYPICAL_GENERATION_SECONDS
    ? 95 + (1 - Math.exp(-(elapsedSec - TYPICAL_GENERATION_SECONDS) / 60)) * 4.5
    : linearPct;
  const pct = Math.min(99.5, Math.max(2, overflowPct));
  const phaseIdx = Math.min(
    BUILD_PHASES.length - 1,
    Math.floor((pct / 100) * BUILD_PHASES.length),
  );

  return (
    <div className="gen-lookcard">
      <button type="button" className="gen-lookcard-media" onClick={onOpen}>
        {isDone && generation.video_url ? (
          <video
            src={generation.video_url}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          />
        ) : (
          <div className={`gen-lookcard-placeholder${isFailed ? ' is-failed' : ''}`}>
            {isBusy && (
              <>
                <div className="gen-lookcard-busy is-busy" aria-hidden="true" />
                <div className="gen-lookcard-pulse" aria-hidden="true" />
                <svg className="gen-lookcard-border" viewBox="0 0 90 160" preserveAspectRatio="none" aria-hidden="true">
                  <rect className="gen-build-track" x="1" y="1" width="88" height="158" rx="6" ry="6" pathLength={100} />
                  <rect className="gen-build-fill" x="1" y="1" width="88" height="158" rx="6" ry="6" pathLength={100} strokeDasharray={`${pct} 100`} />
                </svg>
                <span className="gen-vision">Vision</span>
                <span className="gen-lookcard-phase">{BUILD_PHASES[phaseIdx]}</span>
                <span className="gen-lookcard-pct">{Math.round(pct)}%</span>
              </>
            )}
            {isFailed && <span>Failed</span>}
          </div>
        )}
        {isBusy && <span className="gen-lookcard-chip">{generation.status === 'pending' ? 'Queued' : 'Generating'}</span>}
        <button
          type="button"
          className="gen-lookcard-delete"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm('Delete this look?')) onDelete();
          }}
          aria-label="Delete look"
          title="Delete look"
        >×</button>
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

function UploadPickerModal({
  slot,
  uploads,
  pickedIds,
  currentSlotId,
  onClose,
  onPick,
  onDelete,
  onUploadNew,
}: {
  slot: number;
  uploads: UserUpload[];
  pickedIds: string[];
  currentSlotId: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
  onDelete: (upload: UserUpload) => void;
  onUploadNew: () => void;
}) {
  // Close on Escape so the modal feels like a normal dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="gen-modal-backdrop" onClick={onClose}>
      <div
        className="gen-modal"
        role="dialog"
        aria-label={`Choose photo for slot ${slot + 1}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gen-modal-head">
          <div>
            <h3 className="gen-modal-title">Choose a photo</h3>
            <p className="gen-modal-sub">Tap a photo to drop it into Photo {slot + 1}, or upload a new one.</p>
          </div>
          <button
            type="button"
            className="gen-modal-close"
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </header>

        <button
          type="button"
          className="gen-modal-upload"
          onClick={onUploadNew}
        >
          <span className="gen-slot-plus">+</span>
          Upload new photo
        </button>

        {uploads.length === 0 ? (
          <div className="gen-empty">No uploads yet — tap above to add one.</div>
        ) : (
          <div className="gen-modal-grid">
            {uploads.map(u => {
              const isCurrent = u.id === currentSlotId;
              const inOther = pickedIds.includes(u.id) && !isCurrent;
              return (
                <div key={u.id} className={`gen-modal-thumb${isCurrent ? ' is-picked' : ''}${inOther ? ' is-inuse' : ''}`}>
                  <button
                    type="button"
                    className="gen-modal-thumb-pick"
                    onClick={() => onPick(u.id)}
                    aria-label={isCurrent ? 'Currently picked' : 'Pick this photo'}
                  >
                    <img src={u.public_url} alt="" />
                    {isCurrent && <span className="gen-thumb-check">✓</span>}
                    {inOther && <span className="gen-modal-thumb-badge">In use</span>}
                  </button>
                  <button
                    type="button"
                    className="gen-modal-thumb-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Delete this upload?')) onDelete(u);
                    }}
                    aria-label="Delete photo"
                    title="Delete photo"
                  >×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StepRail({
  step, photosCount, productsCount, heightLabel, ageLabel, style,
}: {
  step: Step;
  photosCount: number;
  productsCount: number;
  heightLabel: string;
  ageLabel: string;
  style: string;
}) {
  const filled = {
    photos: photosCount > 0,
    products: productsCount > 0,
    about: !!heightLabel && !!ageLabel,
    style: !!style,
    review: false,
    result: false,
  } as Record<Step, boolean>;
  const items: { k: Step; label: string }[] = [
    { k: 'photos',   label: 'Photos' },
    { k: 'products', label: 'Products' },
    { k: 'about',    label: 'About' },
    { k: 'style',    label: 'Style' },
    { k: 'review',   label: 'Review' },
  ];
  const activeIdx = STEP_ORDER.indexOf(step);
  return (
    <nav className="gen-rail" aria-label="Generate steps">
      <ol className="gen-rail-glass">
        {items.map((item, i) => {
          const cls =
            i === activeIdx ? 'is-active' :
            filled[item.k] ? 'is-done' : '';
          return (
            <li key={item.k} className={`gen-rail-item ${cls}`}>
              <span className="gen-rail-num">
                {filled[item.k] && i !== activeIdx ? '✓' : i + 1}
              </span>
              <span className="gen-rail-label">{item.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

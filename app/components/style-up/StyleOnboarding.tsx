// First-run onboarding for the Style app. A brand-new shopper lands here
// BEFORE the landing/picker and hands over the context the stylist actually
// reads, instead of being asked for it ad-hoc mid-chat.
//
// Everything is written to the SAME rows the in-chat context editor writes to
// (StyleUpExperience's `saveCtx` / `onPhotoFile`), so an answer here and an
// edit there are the same profile:
//   photo         → user_uploads (`user-uploads` bucket) + user_generation_slots
//   height/weight → profiles.height_* / weight_* — what `isProfileReady` gates on
//   age, gender   → profiles.age_label / gender
//   style tags    → profiles.fashion_styles      ─┐ both read by style-up-chat
//   free text     → profiles.custom_style_prompt ─┘ (index.ts:126-127) and had
//                   no input anywhere in the Style app before this screen.
//
// Photos persist as they're picked (an upload is a write either way); the
// profile fields are written once on Finish.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getUserHeightAge, getUserCustomStyle, updateUserHeightAge, updateUserCustomStyle } from '~/services/profiles';
import { getUserGender, updateUserGender, type UserGender } from '~/services/genders';
import {
  listUserUploads, getUserSlots, saveUserSlots, uploadUserPhoto, deleteUserUpload, validateSelfie,
} from '~/services/user-generations';
import { HEIGHT_OPTIONS, WEIGHT_OPTIONS, AGE_OPTIONS, FASHION_STYLE_OPTIONS } from '~/constants/stats';
import '~/styles/style-up.css';

const MAX_PHOTOS = 3;
const SEEN_KEY = 'catalog:style-onboarded';

/** Mount test for the caller. Show onboarding until the profile carries what
 *  the stylist needs (`isProfileReady`) — unless the shopper has already been
 *  through it and chose "later", which would otherwise re-wall them on every
 *  visit with no way past. */
export function needsStyleOnboarding(profileReady: boolean): boolean {
  if (profileReady) return false;
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return true; }
}

const STEPS = [
  { key: 'photo', title: 'Add a photo of you', sub: 'One clear, front-facing photo of just you. It’s how your stylist styles the real you, and how you see every pick on yourself.' },
  { key: 'body', title: 'Your basics', sub: 'So nothing they pick shows up in the wrong size.' },
  { key: 'gender', title: 'What should we shop?', sub: 'Sets which side of the catalog your stylist pulls from.' },
  { key: 'style', title: 'Your style', sub: 'Tap anything that sounds like you.' },
  { key: 'notes', title: 'Anything your stylist should know?', sub: 'Fit quirks, brands you love, colours you never wear. They read this before every pick.' },
] as const;

const parseTags = (raw: string | null) => (raw || '').split(',').map(s => s.trim()).filter(Boolean);

export default function StyleOnboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<(string | null)[]>(Array(MAX_PHOTOS).fill(null));
  const [slots, setSlots] = useState<(string | null)[]>(Array(MAX_PHOTOS).fill(null));
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<UserGender>('unknown');
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef(0);

  // Prefill from whatever the profile already has — a shopper can arrive with
  // a photo from the Catalog app but no stats, and saveUserSlots overwrites the
  // whole array, so the existing slots have to be loaded before we touch them.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ha, g, style, uploads, saved] = await Promise.all([
        getUserHeightAge(userId),
        getUserGender(userId),
        getUserCustomStyle(userId),
        listUserUploads(userId),
        getUserSlots(userId, MAX_PHOTOS),
      ]);
      if (cancelled) return;
      const byId = new Map(uploads.map(u => [u.id, u.public_url]));
      let next = saved.slice(0, MAX_PHOTOS);
      while (next.length < MAX_PHOTOS) next.push(null);
      // Same fallback the chat's loadContext uses: no explicit slots → most
      // recent uploads, so an existing photo isn't asked for twice.
      if (!next.some(Boolean) && uploads.length) {
        next = uploads.slice(0, MAX_PHOTOS).map(u => u.id as string | null);
        while (next.length < MAX_PHOTOS) next.push(null);
      }
      setSlots(next);
      setPhotos(next.map(id => (id ? byId.get(id) ?? null : null)));
      if (ha.heightLabel) setHeight(ha.heightLabel);
      if (ha.weightLabel) setWeight(ha.weightLabel);
      if (ha.ageLabel) setAge(ha.ageLabel);
      setTags(parseTags(ha.fashionStyles));
      setGender(g);
      if (style) setNotes(style);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const done = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode — the profile gate still applies */ }
    onDone();
  }, [onDone]);

  // Upload → validate → pin the slot. Mirrors the chat's onPhotoFile: a photo
  // that fails the try-on check is deleted rather than left in the bucket.
  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const slot = slotRef.current;
    setError(null);
    setUploading(slot);
    const { data, error: upErr } = await uploadUserPhoto(file, userId);
    if (upErr || !data) {
      setUploading(null);
      setError(upErr ?? 'Couldn’t upload that photo. Try again.');
      return;
    }
    const check = await validateSelfie(data.public_url);
    if (!check.ok) {
      await deleteUserUpload(data);
      setUploading(null);
      setError(check.reason ?? 'That photo won’t work for a try-on. Use a clear, front-facing photo of just you.');
      return;
    }
    const next = [...slots];
    next[slot] = data.id;
    setSlots(next);
    setPhotos(prev => { const p = [...prev]; p[slot] = data.public_url; return p; });
    await saveUserSlots(userId, next);
    setUploading(null);
  }, [userId, slots]);

  const finish = useCallback(async () => {
    setSaving(true);
    setError(null);
    const h = HEIGHT_OPTIONS.find(o => o.label === height);
    const w = WEIGHT_OPTIONS.find(o => o.label === weight);
    const results = await Promise.all([
      updateUserHeightAge(userId, {
        heightCm: h?.cm ?? null, heightLabel: height || null,
        weightKg: w?.kg ?? null, weightLabel: weight || null,
        ageLabel: age || null,
        fashionStyles: tags.join(', '),
      }),
      updateUserGender(userId, gender),
      updateUserCustomStyle(userId, notes),
    ]);
    setSaving(false);
    const first = results.find(r => r.error)?.error;
    if (first) { setError(first); return; }
    done();
  }, [userId, height, weight, age, gender, tags, notes, done]);

  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  // Only the two `isProfileReady` inputs are required — a selfie, and height +
  // weight. Everything after is answerable or skippable.
  const filled = s.key === 'photo' ? photos.some(Boolean)
    : s.key === 'body' ? !!height && !!weight
    : s.key === 'gender' ? gender !== 'unknown'
    : s.key === 'style' ? tags.length > 0
    : notes.trim().length > 0;
  const required = s.key === 'photo' || s.key === 'body';

  return (
    <div className="su-apply" style={{ ['--su-accent' as string]: '#8aa0c0' }}>
      <div className="su-tape" style={{ margin: '0 0 16px' }} aria-hidden="true">
        <div className="su-tape-fill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <div className="su-section-label" style={{ paddingLeft: 0 }}>Step {step + 1} of {STEPS.length}</div>
      <h1>{s.title}</h1>
      <p>{s.sub}</p>

      {s.key === 'photo' && (
        <div className="su-context-photos su-context-photos--edit">
          {photos.map((src, i) => (
            <button
              type="button"
              key={i}
              className="su-context-photo su-context-photo--edit"
              style={{ width: 84, height: 84 }}
              onClick={() => { slotRef.current = i; fileRef.current?.click(); }}
              disabled={uploading !== null}
              aria-label={src ? `Replace photo ${i + 1}` : `Add photo ${i + 1}`}
            >
              {uploading === i
                ? <span className="su-render-spinner" aria-hidden="true" />
                : src
                  ? <img src={src} alt="" />
                  : <span className="su-context-photo-add" aria-hidden="true">+</span>}
            </button>
          ))}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => void onFile(e)} />
        </div>
      )}

      {s.key === 'body' && (
        <div className="su-apply-form">
          {/* Each <select> is wrapped in .su-edit-row because .su-edit-input
              carries `flex: 1 1 0` — row-designed (that's the only context the
              in-chat editor uses it in). Dropped straight into these
              flex-COLUMN labels the basis:0 applies to the block axis and
              overrides `height: 36px`, collapsing the control to 19px. */}
          <label>
            <span>Height</span>
            <div className="su-edit-row">
              <select className="su-edit-input" value={height} onChange={e => setHeight(e.target.value)}>
                <option value="">Select…</option>
                {HEIGHT_OPTIONS.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
              </select>
            </div>
          </label>
          <label>
            <span>Weight</span>
            <div className="su-edit-row">
              <select className="su-edit-input" value={weight} onChange={e => setWeight(e.target.value)}>
                <option value="">Select…</option>
                {WEIGHT_OPTIONS.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
              </select>
            </div>
          </label>
          <label>
            <span>Age (optional)</span>
            <div className="su-edit-row">
              <select className="su-edit-input" value={age} onChange={e => setAge(e.target.value)}>
                <option value="">Rather not say</option>
                {AGE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </label>
        </div>
      )}

      {s.key === 'gender' && (
        <div className="su-edit-gender">
          {(['male', 'female'] as const).map(g => (
            <button
              type="button"
              key={g}
              className={`su-edit-gender-btn${gender === g ? ' is-on' : ''}`}
              onClick={() => setGender(gender === g ? 'unknown' : g)}
            >
              {g === 'male' ? 'Menswear' : 'Womenswear'}
            </button>
          ))}
        </div>
      )}

      {s.key === 'style' && (
        <div className="su-choose-options">
          {FASHION_STYLE_OPTIONS.map(t => (
            <button
              type="button"
              key={t}
              className={`su-choose-opt${tags.includes(t) ? ' is-on' : ''}`}
              aria-pressed={tags.includes(t)}
              onClick={() => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
            >
              <span className="su-choose-opt-label">{t}</span>
            </button>
          ))}
        </div>
      )}

      {s.key === 'notes' && (
        <textarea
          className="su-edit-style"
          rows={4}
          maxLength={400}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="I’m long in the arms so sleeves run short, I live in black, nothing cropped…"
        />
      )}

      {error && <div className="su-apply-error">{error}</div>}

      <div className="su-apply-actions">
        {step > 0 && (
          <button type="button" className="su-apply-back" onClick={() => { setError(null); setStep(step - 1); }} disabled={saving}>
            Back
          </button>
        )}
        <button
          type="button"
          className="su-apply-cta"
          disabled={(required && !filled) || uploading !== null || saving}
          onClick={() => (last ? void finish() : setStep(step + 1))}
        >
          {last ? (saving ? 'Saving…' : 'Meet your stylists') : filled || required ? 'Next' : 'Skip'}
        </button>
      </div>

      <button type="button" className="su-become-stylist" onClick={done} disabled={saving}>
        I’ll do this later
      </button>
    </div>
  );
}

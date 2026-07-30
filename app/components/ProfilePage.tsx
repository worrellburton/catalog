import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import { AvatarUpload } from './AvatarCropModal';
import { HEIGHT_OPTIONS, WEIGHT_OPTIONS, AGE_OPTIONS } from '~/constants/stats';
import { getUserHeightAge, updateUserHeightAge, updateUserFullName } from '~/services/profiles';
import { getUserGender, updateUserGender, type UserGender } from '~/services/genders';
import { refreshAuthUser } from '~/hooks/useAuth';
import { supabase } from '~/utils/supabase';
import BecomeCreatorSection from './BecomeCreatorSection';
import LegalPage, { type LegalKind } from './LegalPage';
import '~/styles/profile-page.css';

interface ProfilePageProps {
  user: {
    id?: string;
    displayName?: string;
    email?: string;
    avatarUrl?: string;
    role?: string;
  };
  onClose: () => void;
  /** Renders the shared Saved screen inside the "Saved" tab. When omitted,
   *  the tab is hidden (e.g. signed-out / no bookmarks plumbing). */
  renderSaved?: () => ReactNode;
}

interface ProfileData {
  fullName: string;
  heightCm: number | null;
  heightLabel: string | null;
  weightKg: number | null;
  weightLabel: string | null;
  ageLabel: string | null;
  gender: UserGender;
  instagram: string;
  tiktok: string;
}

export default function ProfilePage({ user, onClose, renderSaved }: ProfilePageProps) {
  const [legal, setLegal] = useState<LegalKind | null>(null);
  // While a legal page is open, let its own Escape handler close it first.
  useEscapeKey(onClose, !legal);

  const [tab, setTab] = useState<'profile' | 'saved'>('profile');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);

  const [fullName, setFullName] = useState(user.displayName ?? '');
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [heightLabel, setHeightLabel] = useState<string | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [weightLabel, setWeightLabel] = useState<string | null>(null);
  const [ageLabel, setAgeLabel] = useState<string | null>(null);
  const [gender, setGender] = useState<UserGender>('unknown');
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');

  const [initial, setInitial] = useState<ProfileData | null>(null);

  useEffect(() => {
    if (!user.id) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const [stats, g, socialsRes] = await Promise.all([
        getUserHeightAge(user.id!),
        getUserGender(user.id!),
        supabase
          ? supabase.from('profiles').select('instagram_handle, tiktok_handle').eq('id', user.id!).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      const social = (socialsRes.data as { instagram_handle: string | null; tiktok_handle: string | null } | null) ?? null;
      const ig = social?.instagram_handle ?? '';
      const tt = social?.tiktok_handle ?? '';
      setHeightCm(stats.heightCm);
      setHeightLabel(stats.heightLabel);
      setWeightKg(stats.weightKg);
      setWeightLabel(stats.weightLabel);
      setAgeLabel(stats.ageLabel);
      setGender(g);
      setInstagram(ig);
      setTiktok(tt);
      setInitial({
        fullName: user.displayName ?? '',
        heightCm: stats.heightCm,
        heightLabel: stats.heightLabel,
        weightKg: stats.weightKg,
        weightLabel: stats.weightLabel,
        ageLabel: stats.ageLabel,
        gender: g,
        instagram: ig,
        tiktok: tt,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  const isDirty = initial && (
    fullName !== initial.fullName ||
    heightCm !== initial.heightCm ||
    weightKg !== initial.weightKg ||
    ageLabel !== initial.ageLabel ||
    gender !== initial.gender ||
    instagram.trim() !== initial.instagram ||
    tiktok.trim() !== initial.tiktok
  );

  // Strip a leading @ and any IG/TikTok URL chrome so we store the bare handle.
  const normalizeHandle = (v: string): string =>
    v.trim()
      .replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\//i, '')
      .replace(/^@/, '')
      .replace(/[/?#].*$/, '')
      .trim();

  const handleSave = useCallback(async () => {
    if (!user.id || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const ig = normalizeHandle(instagram);
    const tt = normalizeHandle(tiktok);
    const results = await Promise.all([
      updateUserHeightAge(user.id, { heightCm, heightLabel, weightKg, weightLabel, ageLabel }),
      updateUserGender(user.id, gender),
      fullName.trim() !== (initial?.fullName ?? '') ? updateUserFullName(user.id, fullName) : Promise.resolve({}),
      supabase
        ? supabase.from('profiles').update({ instagram_handle: ig || null, tiktok_handle: tt || null }).eq('id', user.id)
        : Promise.resolve({}),
    ]);
    setSaving(false);
    const firstError = results.find(r => 'error' in r && (r as { error?: string }).error);
    if (firstError && 'error' in firstError) { setError((firstError as { error: string }).error); return; }
    setInstagram(ig);
    setTiktok(tt);
    setInitial({ fullName: fullName.trim(), heightCm, heightLabel, weightKg, weightLabel, ageLabel, gender, instagram: ig, tiktok: tt });
    setSaved(true);
    refreshAuthUser();
    setTimeout(() => setSaved(false), 2000);
  }, [user.id, saving, fullName, heightCm, heightLabel, weightKg, weightLabel, ageLabel, gender, instagram, tiktok, initial]);

  const renderedAvatar = avatarOverride || user.avatarUrl;

  return (
    <>
    <div className="profile-page-overlay">
      <div className="profile-page-container">
        <div className="profile-page-header">
          <div className="profile-page-header-left">
            <button className="profile-page-back" onClick={onClose} aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <h1 className="profile-page-title">Profile</h1>
          </div>
        </div>

        {loading ? (
          <div className="profile-page-loading">
            <div className="profile-page-skeleton profile-page-skeleton-avatar" />
            <div className="profile-page-skeleton profile-page-skeleton-line" />
            <div className="profile-page-skeleton profile-page-skeleton-line short" />
          </div>
        ) : (
          <div className="profile-page-body">
            <div className="profile-page-avatar-section">
              <div className="profile-page-avatar-ring">
                {user.id ? (
                  <AvatarUpload
                    userId={user.id}
                    currentUrl={renderedAvatar}
                    fallbackInitial={(fullName || user.email || '?').charAt(0)}
                    onUploaded={(url) => {
                      setAvatarOverride(url);
                      refreshAuthUser();
                    }}
                  />
                ) : renderedAvatar ? (
                  <img src={renderedAvatar} alt="" className="profile-page-avatar-img" referrerPolicy="no-referrer" />
                ) : (
                  <span className="profile-page-avatar-fallback">
                    {(fullName || user.email || '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="profile-page-avatar-hint">Tap to change photo</span>
            </div>

            <div className="profile-page-section">
              <h2 className="profile-page-section-title">About you</h2>

              <label className="profile-page-field">
                <span className="profile-page-field-label">Name</span>
                <input
                  type="text"
                  className="profile-page-input"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Your name"
                  disabled={saving}
                />
              </label>

              <div className="profile-page-field">
                <span className="profile-page-field-label">Gender</span>
                <div className="profile-page-segmented">
                  {(['female', 'male', 'unknown'] as const).map(g => (
                    <button
                      key={g}
                      type="button"
                      className={`profile-page-seg-btn ${gender === g ? 'is-active' : ''}`}
                      onClick={() => setGender(g)}
                      disabled={saving}
                    >
                      {g === 'unknown' ? 'Prefer not to say' : g === 'female' ? 'Women' : 'Men'}
                    </button>
                  ))}
                </div>
              </div>

              {user.email && (
                <div className="profile-page-field">
                  <span className="profile-page-field-label">Email</span>
                  <div className="profile-page-readonly">{user.email}</div>
                </div>
              )}

              <div className="profile-page-field-row">
                <label className="profile-page-field">
                  <span className="profile-page-field-label">Instagram</span>
                  <div className="profile-page-handle-input">
                    <span className="profile-page-handle-at">@</span>
                    <input
                      type="text"
                      className="profile-page-input profile-page-input-handle"
                      value={instagram}
                      onChange={e => setInstagram(e.target.value)}
                      placeholder="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={saving}
                    />
                  </div>
                </label>
                <label className="profile-page-field">
                  <span className="profile-page-field-label">TikTok</span>
                  <div className="profile-page-handle-input">
                    <span className="profile-page-handle-at">@</span>
                    <input
                      type="text"
                      className="profile-page-input profile-page-input-handle"
                      value={tiktok}
                      onChange={e => setTiktok(e.target.value)}
                      placeholder="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={saving}
                    />
                  </div>
                </label>
              </div>
            </div>

            {/* Only shoppers (not creators/admins) can apply to create. */}
            {(!user.role || user.role === 'shopper') && <BecomeCreatorSection />}

            <div className="profile-page-section">
              <h2 className="profile-page-section-title">Body profile</h2>
              <p className="profile-page-section-desc">Used to show you relevant looks and for virtual try-on.</p>

              <div className="profile-page-field-row">
                <label className="profile-page-field">
                  <span className="profile-page-field-label">Height</span>
                  <select
                    className="profile-page-select"
                    value={heightCm ?? ''}
                    onChange={e => {
                      const cm = Number(e.target.value);
                      const opt = HEIGHT_OPTIONS.find(h => h.cm === cm);
                      if (!opt) { setHeightCm(null); setHeightLabel(null); return; }
                      setHeightCm(opt.cm);
                      setHeightLabel(opt.label);
                    }}
                    disabled={saving}
                  >
                    <option value="">Select</option>
                    {HEIGHT_OPTIONS.map(h => (
                      <option key={h.cm} value={h.cm}>{h.label}</option>
                    ))}
                  </select>
                </label>
                <label className="profile-page-field">
                  <span className="profile-page-field-label">Weight</span>
                  <select
                    className="profile-page-select"
                    value={weightKg ?? ''}
                    onChange={e => {
                      const kg = Number(e.target.value);
                      const opt = WEIGHT_OPTIONS.find(w => w.kg === kg);
                      if (!opt) { setWeightKg(null); setWeightLabel(null); return; }
                      setWeightKg(opt.kg);
                      setWeightLabel(opt.label);
                    }}
                    disabled={saving}
                  >
                    <option value="">Select</option>
                    {WEIGHT_OPTIONS.map(w => (
                      <option key={w.kg} value={w.kg}>{w.label}</option>
                    ))}
                  </select>
                </label>
                <label className="profile-page-field">
                  <span className="profile-page-field-label">Age range</span>
                  <select
                    className="profile-page-select"
                    value={ageLabel ?? ''}
                    onChange={e => setAgeLabel(e.target.value || null)}
                    disabled={saving}
                  >
                    <option value="">Select</option>
                    {AGE_OPTIONS.map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {error && (
              <div className="profile-page-error" role="alert">{error}</div>
            )}

            <div className="profile-page-actions">
              <button
                type="button"
                className={`profile-page-save ${saved ? 'is-saved' : ''}`}
                onClick={handleSave}
                disabled={saving || !isDirty || saved}
              >
                {saved ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Saved
                  </>
                ) : saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            <div className="profile-page-footer">
              <button
                type="button"
                className="profile-page-logout"
                onClick={onClose}
              >
                Done
              </button>
              <div className="profile-page-legal">
                <button type="button" className="profile-page-legal-link" onClick={() => setLegal('privacy')}>
                  Privacy Policy
                </button>
                <span className="profile-page-legal-dot" aria-hidden="true">·</span>
                <button type="button" className="profile-page-legal-link" onClick={() => setLegal('terms')}>
                  Terms of Service
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    {legal && <LegalPage kind={legal} onClose={() => setLegal(null)} />}
    </>
  );
}

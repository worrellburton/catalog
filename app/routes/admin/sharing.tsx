import { useEffect, useRef, useState } from 'react';
import {
  SHARE_DEFAULTS,
  loadShareSettings,
  saveShareSettings,
  uploadShareImage,
  type ShareSettings,
} from '~/services/share-settings';

// Page-local stylesheet — extracted from admin.css so the Sharing
// preview/mockup styles don't ship to every other admin route.
import '~/styles/admin-sharing.css';

export default function AdminSharing() {
  const [loaded, setLoaded] = useState<ShareSettings>(SHARE_DEFAULTS);
  const [draft, setDraft] = useState<ShareSettings>(SHARE_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadShareSettings()
      .then(s => { setLoaded(s); setDraft(s); })
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof ShareSettings>(k: K, v: ShareSettings[K]) {
    setDraft(d => ({ ...d, [k]: v }));
    setStatus('idle');
  }

  async function handleImageUpload(file: File) {
    setUploading(true);
    setErrorMsg(null);
    try {
      const url = await uploadShareImage(file);
      update('imageUrl', url);
    } catch (err: any) {
      setErrorMsg(`Upload failed: ${err?.message ?? 'unknown error'}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSave() {
    setSaving(true);
    setStatus('idle');
    setErrorMsg(null);
    try {
      await saveShareSettings(draft);
      setLoaded(draft);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(loaded);
  const domain = (() => {
    try { return new URL(draft.url).host.replace(/^www\./, ''); }
    catch { return draft.url || 'catalog.shop'; }
  })();

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Sharing</h1>
        <p className="admin-page-subtitle">
          Manage the rich link preview that appears when someone shares a catalog URL in iMessage.
        </p>
      </div>

      <div className="admin-sharing-layout">
        <div className="admin-settings-section admin-sharing-form">
          <h2 className="admin-settings-heading">iMessage link preview</h2>
          <p className="admin-settings-desc">
            iMessage builds its preview card from this page&rsquo;s Open Graph tags. Edits here
            update <code>app_settings</code>; the rendered <code>&lt;meta&gt;</code> tags refresh
            on the next Vercel deploy.
          </p>

          <div className="admin-settings-row">
            <label className="admin-settings-label" htmlFor="share-title">Title</label>
            <input
              id="share-title"
              className="admin-sharing-input"
              type="text"
              value={draft.title}
              onChange={e => update('title', e.target.value)}
              disabled={loading || saving}
              maxLength={70}
              placeholder="catalog"
            />
            <span className="admin-sharing-hint">{draft.title.length}/70 — appears as the headline on the card.</span>
          </div>

          <div className="admin-settings-row">
            <label className="admin-settings-label" htmlFor="share-description">Description</label>
            <textarea
              id="share-description"
              className="admin-sharing-input admin-sharing-textarea"
              value={draft.description}
              onChange={e => update('description', e.target.value)}
              disabled={loading || saving}
              rows={3}
              maxLength={200}
              placeholder="A creator-powered shopping platform…"
            />
            <span className="admin-sharing-hint">{draft.description.length}/200 — shown under the title in some unfurlers.</span>
          </div>

          <div className="admin-settings-row">
            <label className="admin-settings-label" htmlFor="share-site-name">Site name</label>
            <input
              id="share-site-name"
              className="admin-sharing-input"
              type="text"
              value={draft.siteName}
              onChange={e => update('siteName', e.target.value)}
              disabled={loading || saving}
              maxLength={40}
              placeholder="catalog"
            />
          </div>

          <div className="admin-settings-row">
            <label className="admin-settings-label" htmlFor="share-url">Canonical URL</label>
            <input
              id="share-url"
              className="admin-sharing-input"
              type="url"
              value={draft.url}
              onChange={e => update('url', e.target.value)}
              disabled={loading || saving}
              placeholder="https://catalog.shop"
            />
          </div>

          <div className="admin-settings-row">
            <label className="admin-settings-label">Preview image</label>
            <div className="admin-sharing-image-row">
              <div className="admin-sharing-image-thumb">
                {draft.imageUrl ? (
                  <img src={draft.imageUrl} alt="preview" />
                ) : (
                  <div className="admin-sharing-image-empty">No image</div>
                )}
              </div>
              <div className="admin-sharing-image-actions">
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || saving}
                >
                  {uploading ? 'Uploading…' : draft.imageUrl ? 'Replace image' : 'Upload image'}
                </button>
                {draft.imageUrl && (
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => update('imageUrl', '')}
                    disabled={uploading || saving}
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void handleImageUpload(f);
                  }}
                />
              </div>
            </div>
            <span className="admin-sharing-hint">
              1200×630 PNG or JPG works best across iMessage, Twitter, Slack, and WhatsApp. Max 5 MB.
            </span>
          </div>

          <div className="admin-settings-row">
            <label className="admin-settings-label">Image URL</label>
            <input
              className="admin-sharing-input"
              type="url"
              value={draft.imageUrl}
              onChange={e => update('imageUrl', e.target.value)}
              disabled={loading || saving}
              placeholder="https://…/og.png"
            />
            <span className="admin-sharing-hint">Or paste an external image URL instead of uploading.</span>
          </div>

          <div className="admin-settings-actions">
            <button
              className="admin-btn admin-btn-primary"
              onClick={handleSave}
              disabled={loading || saving || !isDirty}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {status === 'saved' && (
              <span className="admin-settings-status admin-settings-status--ok">Saved</span>
            )}
            {status === 'error' && (
              <span className="admin-settings-status admin-settings-status--err">
                {errorMsg || 'Save failed'}
              </span>
            )}
            {!isDirty && status === 'idle' && !loading && (
              <span className="admin-sharing-hint" style={{ alignSelf: 'center' }}>No changes</span>
            )}
          </div>
        </div>

        <div className="admin-sharing-preview-col">
          <h2 className="admin-settings-heading">Live preview</h2>
          <p className="admin-settings-desc">
            How the link looks in iMessage. The actual rendering varies per platform.
          </p>

          <div className="admin-sharing-imessage">
            <div className="admin-sharing-imessage-meta">iMessage</div>
            <div className="admin-sharing-bubble">
              {draft.imageUrl ? (
                <div className="admin-sharing-bubble-image">
                  <img src={draft.imageUrl} alt="" />
                </div>
              ) : (
                <div className="admin-sharing-bubble-image admin-sharing-bubble-image-placeholder">
                  Upload a preview image to see it here
                </div>
              )}
              <div className="admin-sharing-bubble-body">
                <div className="admin-sharing-bubble-title">
                  {draft.title || 'catalog'}
                </div>
                {draft.description && (
                  <div className="admin-sharing-bubble-desc">
                    {draft.description}
                  </div>
                )}
                <div className="admin-sharing-bubble-domain">{domain}</div>
              </div>
            </div>
            <div className="admin-sharing-imessage-time">Read 8:58 AM</div>
          </div>
        </div>
      </div>
    </div>
  );
}

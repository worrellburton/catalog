import { useEffect, useState, useCallback } from 'react';
import {
  getMyCreatorRequest,
  submitCreatorRequest,
  type CreatorRequest,
} from '~/services/become-creator';

/**
 * Profile section letting a shopper apply to become a creator. Renders its
 * own state machine: not-applied → form, pending/approved/denied → status.
 * The parent only mounts this for non-creator/admin users.
 */
export default function BecomeCreatorSection() {
  const [request, setRequest] = useState<CreatorRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyCreatorRequest()
      .then(r => { if (!cancelled) { setRequest(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const { error: err } = await submitCreatorRequest(message);
    setSubmitting(false);
    if (err) { setError(err); return; }
    const fresh = await getMyCreatorRequest();
    setRequest(fresh);
  }, [message]);

  if (loading) return null;

  return (
    <div className="profile-page-section">
      <h2 className="profile-page-section-title">Become a creator</h2>

      {!request && (
        <>
          <p className="profile-page-section-desc">
            Share your looks with the world. Apply and our team will review your account.
          </p>
          <label className="profile-page-field">
            <span className="profile-page-field-label">Why do you want to create? (optional)</span>
            <textarea
              className="profile-page-input"
              rows={3}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Tell us about your style…"
              disabled={submitting}
            />
          </label>
          {error && <p className="profile-page-error">{error}</p>}
          <button
            type="button"
            className="profile-page-creator-btn"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : 'Apply to become a creator'}
          </button>
        </>
      )}

      {request?.status === 'pending' && (
        <p className="profile-page-creator-status profile-page-creator-status--pending">
          ⏳ Your application is under review. We'll be in touch soon.
        </p>
      )}
      {request?.status === 'approved' && (
        <p className="profile-page-creator-status profile-page-creator-status--approved">
          🎉 You're a creator! Reopen the app to start building your catalog.
        </p>
      )}
      {request?.status === 'denied' && (
        <p className="profile-page-creator-status profile-page-creator-status--denied">
          Your application wasn't approved this time. Reach out to support if you have questions.
        </p>
      )}
    </div>
  );
}

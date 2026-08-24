// /style/apply — the "become a stylist" application form (Phase 2.5).
//
// Anyone signed in on the Style app can request to become a human stylist.
// Submissions land in stylist_applications with status='pending'; admins
// approve/reject there (Phase 4). One pending row per user (enforced by a
// partial unique index in the migration) — the form respects that and shows
// the pending / rejected / approved state instead of a fresh form when a row
// already exists.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
// style-up.css owns .su-apply* rules and is otherwise loaded only from inside
// StyleUpExperience — pull it in here so the standalone apply route paints.
import '~/styles/style-up.css';

type GenderFocus = 'men' | 'women' | 'unisex';
type Status = 'pending' | 'approved' | 'rejected';

interface Application {
  id: string;
  status: Status;
  display_name: string;
  created_at: string;
  admin_notes: string | null;
}

export default function StyleApplyRoute() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [latest, setLatest] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    display_name: '',
    bio: '',
    sample_url: '',
    gender_focus: '' as '' | GenderFocus,
  });

  // Latest application for this user (any status). RLS scopes to own rows.
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('stylist_applications')
        .select('id, status, display_name, created_at, admin_notes')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      setLatest(data as Application | null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const canSubmit = useMemo(() =>
    form.display_name.trim().length >= 2 && !submitting,
  [form.display_name, submitting]);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from('stylist_applications').insert({
      user_id: user.id,
      display_name: form.display_name.trim(),
      bio: form.bio.trim() || null,
      sample_url: form.sample_url.trim() || null,
      gender_focus: form.gender_focus || null,
    });
    setSubmitting(false);
    if (error) {
      // The partial unique index yields "23505" if a pending row already
      // exists. Show the current-status pane instead of the raw error.
      if (error.code === '23505') {
        // Re-fetch to render the pending state.
        const { data } = await supabase
          .from('stylist_applications')
          .select('id, status, display_name, created_at, admin_notes')
          .eq('user_id', user.id).order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        setLatest(data as Application | null);
        return;
      }
      setError(error.message);
      return;
    }
    // Re-read so the UI flips to the pending state.
    const { data } = await supabase
      .from('stylist_applications')
      .select('id, status, display_name, created_at, admin_notes')
      .eq('user_id', user.id).order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    setLatest(data as Application | null);
  }, [user, form, canSubmit]);

  if (authLoading || loading) {
    return <div className="su-apply su-apply--loading">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="su-apply">
        <h1>Become a stylist</h1>
        <p>Sign in to apply.</p>
        <button type="button" className="su-apply-back" onClick={() => navigate('/style')}>Back</button>
      </div>
    );
  }

  if (latest && latest.status === 'approved') {
    return (
      <div className="su-apply">
        <h1>You&apos;re a stylist</h1>
        <p>You were approved on {new Date(latest.created_at).toLocaleDateString()}. Set up your showroom to start receiving requests.</p>
        <button type="button" className="su-apply-cta" onClick={() => navigate('/style/showroom')}>Open showroom</button>
      </div>
    );
  }

  if (latest && latest.status === 'pending') {
    return (
      <div className="su-apply">
        <h1>Application received</h1>
        <p>You applied as <strong>{latest.display_name}</strong> on {new Date(latest.created_at).toLocaleDateString()}. We&apos;ll be in touch.</p>
        <button type="button" className="su-apply-back" onClick={() => navigate('/style')}>Back to stylists</button>
      </div>
    );
  }

  return (
    <div className="su-apply">
      <h1>Become a stylist</h1>
      <p>Real humans styling real humans. Tell us who you are.</p>
      {latest && latest.status === 'rejected' && (
        <div className="su-apply-note">
          Your last application on {new Date(latest.created_at).toLocaleDateString()} wasn&apos;t approved.
          {latest.admin_notes ? <> Notes: {latest.admin_notes}</> : null} Feel free to reapply.
        </div>
      )}
      <form className="su-apply-form" onSubmit={submit}>
        <label>
          <span>Display name</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={40}
            value={form.display_name}
            onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            placeholder="How you want to appear to shoppers"
          />
        </label>
        <label>
          <span>Who do you style?</span>
          <div className="su-apply-radios">
            {(['men','women','unisex'] as const).map(g => (
              <label key={g} className="su-apply-radio">
                <input
                  type="radio"
                  name="gender_focus"
                  value={g}
                  checked={form.gender_focus === g}
                  onChange={() => setForm(f => ({ ...f, gender_focus: g }))}
                />
                <span>{g === 'unisex' ? 'Unisex' : g === 'men' ? 'Men' : 'Women'}</span>
              </label>
            ))}
          </div>
        </label>
        <label>
          <span>Portfolio link (Instagram, site, etc.)</span>
          <input
            type="url"
            value={form.sample_url}
            onChange={e => setForm(f => ({ ...f, sample_url: e.target.value }))}
            placeholder="https://instagram.com/…"
          />
        </label>
        <label>
          <span>A quick line about your style</span>
          <textarea
            rows={3}
            maxLength={280}
            value={form.bio}
            onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
            placeholder="Minimalist tailoring, downtown weekends, thrift-first…"
          />
        </label>
        {error && <div className="su-apply-error">{error}</div>}
        <div className="su-apply-actions">
          <button type="button" className="su-apply-back" onClick={() => navigate('/style')}>Cancel</button>
          <button type="submit" className="su-apply-cta" disabled={!canSubmit}>
            {submitting ? 'Sending…' : 'Send application'}
          </button>
        </div>
      </form>
    </div>
  );
}

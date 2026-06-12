// "Share with a link" — the share-link manager for the business plan.
// Mint a link by naming it (the name IS the URL: /d/<name>) and giving
// it a password; the list below shows every open link with its views,
// Copy, and Close. Viewers land on a password screen at the URL and see
// the latest published snapshot once they enter it.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

interface ShareRow {
  id: string;
  slug: string;
  passcode: string;
  views: number;
  created_at: string;
  last_viewed_at: string | null;
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export default function DocumentShares({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [hasSnapshot, setHasSnapshot] = useState(true);
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!supabase) return;
    void supabase
      .from('document_shares')
      .select('id, slug, passcode, views, created_at, last_viewed_at')
      .eq('revoked', false)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows((data ?? []) as ShareRow[]));
    void supabase
      .from('documents')
      .select('key')
      .eq('key', 'business-plan')
      .maybeSingle()
      .then(({ data }) => setHasSnapshot(!!data));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const urlFor = (slug: string) => `${window.location.origin}/d/${slug}`;

  const create = async () => {
    if (!supabase || busy) return;
    const slug = slugify(name);
    if (!slug) { setError('Name the link — the name becomes the URL.'); return; }
    if (!pass.trim()) { setError('Give it a password.'); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('document_shares').insert({
      doc_key: 'business-plan', slug, passcode: pass.trim(),
    });
    setBusy(false);
    if (err) {
      setError(err.code === '23505' ? `“${slug}” is already an open link — close it first or pick another name.` : err.message);
      return;
    }
    setName('');
    setPass('');
    load();
  };

  const revoke = async (id: string) => {
    if (!supabase) return;
    await supabase.from('document_shares').update({ revoked: true }).eq('id', id);
    load();
  };

  const copy = (slug: string) => {
    void navigator.clipboard?.writeText(urlFor(slug)).then(() => {
      setCopied(slug);
      window.setTimeout(() => setCopied(c => (c === slug ? null : c)), 1600);
    });
  };

  return (
    <div className="docshare-scrim" onClick={onClose}>
      <div className="docshare-panel" role="dialog" aria-label="Share with a link" onClick={e => e.stopPropagation()}>
        <div className="docshare-head">
          <div>
            <h3>Share with a link</h3>
            <p>Each link gets its own URL and password. Viewers see the latest published plan.</p>
          </div>
          <button type="button" className="docshare-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!hasSnapshot && (
          <p className="docshare-warn">
            No plan published yet — open <b>Share → Business plan</b> once and the latest snapshot lands here automatically.
          </p>
        )}

        <div className="docshare-create">
          <label>
            <span>Link</span>
            <div className="docshare-url">
              <em>/d/</em>
              <input
                value={name}
                placeholder="sequoia"
                onChange={e => { setName(e.target.value); setError(null); }}
                onKeyDown={e => { if (e.key === 'Enter') void create(); }}
              />
            </div>
          </label>
          <label>
            <span>Password</span>
            <input
              value={pass}
              placeholder="e.g. lookbook26"
              onChange={e => { setPass(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') void create(); }}
            />
          </label>
          <button type="button" className="docshare-mint" disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create link'}
          </button>
        </div>
        {error && <p className="docshare-error">{error}</p>}

        <div className="docshare-list">
          <p className="docshare-list-label">{rows.length ? 'Open links' : 'No open links yet.'}</p>
          {rows.map(r => (
            <div key={r.id} className="docshare-row">
              <div className="docshare-row-main">
                <code>{urlFor(r.slug)}</code>
                <span className="docshare-meta">
                  password <b>{r.passcode}</b>
                  {' · '}{r.views} view{r.views === 1 ? '' : 's'}
                  {r.last_viewed_at ? ` · last ${new Date(r.last_viewed_at).toLocaleDateString()}` : ''}
                  {' · opened '}{new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              <button type="button" onClick={() => copy(r.slug)}>{copied === r.slug ? 'Copied' : 'Copy'}</button>
              <button type="button" className="docshare-close" onClick={() => void revoke(r.id)}>Close</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Five-step ShopMy creator import.
//
// Steps 1-3 collect the operator's choices; steps 4-5 are ShopMyIngest,
// unchanged — it already owns the dry-run preview, the crawl_jobs polling,
// the progress bar and the skip summary.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import ShopMyIngest from '~/components/ShopMyIngest';
import { canAdvance, toggleSection, type WizardState, type WizardSection } from './shopmy-wizard-state';

interface ProbeResponse {
  success?: boolean;
  error?: string;
  creator?: { handle: string; display_name: string; avatar_url: string | null; bio: string | null } | null;
  // Edge function note: `sections` in the response is a COUNT (matches
  // collections/pins/mapped); the dry-run-only `section_list` field carries
  // the actual {id, title} pairs this wizard needs. See
  // supabase/functions/shopmy-ingest/index.ts's dry-run return.
  section_list?: { id: number; title: string }[];
}

/** Recover an edge function's JSON body from a non-2xx invoke() error.
 *  Mirrors ShopMyIngest.edgeBody — this ingest returns real bodies at 500. */
async function edgeBody(err: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (err as { context?: Response })?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { return await ctx.json(); } catch { return null; }
}

const EMPTY: WizardState = {
  step: 1, url: '', handle: '', displayName: '', bio: '', sections: [], selectedSections: [],
};

export default function ShopMyImportWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [s, setS] = useState<WizardState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  const blocked = canAdvance(s);

  // Re-check the collision guard against whatever handle is CURRENTLY in the
  // box, not just the one ShopMy resolved — an operator can retype it at
  // step 2 (e.g. to dodge a collision), and typing a different real
  // creator's handle back in must re-arm the guard just as surely as the
  // first resolution did. Debounced so it doesn't fire a query per keystroke.
  useEffect(() => {
    if (s.step !== 2) return;
    const handle = s.handle.trim();
    if (!handle) { setExisting(null); return; }
    const t = setTimeout(() => {
      supabase!.from('creators').select('handle, source').eq('handle', handle).maybeSingle()
        .then(({ data: hit }) => setExisting(hit ? (hit.source === 'shopmy' ? 'update' : 'conflict') : null));
    }, 300);
    return () => clearTimeout(t);
  }, [s.step, s.handle]);

  // Step 1 → 2. One dry-run against the whole shop resolves both the creator
  // block and the section list; per-section pin counts come from step 3's
  // own probes, which is why this one passes no section_ids.
  const resolve = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await supabase!.functions.invoke('shopmy-ingest', {
        body: { url: s.url.trim(), dry_run: true, max_collections: 1 },
      });
      const p = (data ?? (err ? await edgeBody(err) : null)) as ProbeResponse | null;
      if (!p?.success) throw new Error(p?.error ?? (err as Error)?.message ?? 'could not read that shop');
      if (!p.creator) throw new Error('ShopMy returned no creator for that shop');

      const sections: WizardSection[] = (p.section_list ?? []).map((x) => ({
        id: x.id, title: x.title, collections: 0, pins: 0,
      }));

      setS((prev) => ({
        ...prev,
        step: 2,
        handle: p.creator!.handle,
        displayName: p.creator!.display_name,
        bio: p.creator!.bio ?? '',
        sections,
        selectedSections: sections.map((x) => x.id),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [s.url]);

  // Step 2 → 3. Count collections and pins per section so the operator can
  // see what they are dropping before they drop it.
  const countSections = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const counted = await Promise.all(s.sections.map(async (sec) => {
        const { data, error: err } = await supabase!.functions.invoke('shopmy-ingest', {
          body: { url: s.url.trim(), dry_run: true, section_ids: [sec.id] },
        });
        const p = (data ?? (err ? await edgeBody(err) : null)) as { collections?: number; pins?: number } | null;
        return { ...sec, collections: p?.collections ?? 0, pins: p?.pins ?? 0 };
      }));
      setS((prev) => ({ ...prev, step: 3, sections: counted }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [s.url, s.sections]);

  if (s.step >= 4) {
    return (
      <ShopMyIngest
        url={s.url.trim()}
        sectionIds={s.selectedSections}
        creatorHandle={s.handle.trim()}
        includeCreator
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Import from ShopMy · step {s.step} of 5</h3>
        <button className="admin-btn admin-btn-secondary" onClick={onClose}>Close</button>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      {s.step === 1 && (
        <>
          <div className="admin-form-group">
            <label htmlFor="shopmy-url">Shop URL</label>
            <input
              id="shopmy-url"
              type="url"
              value={s.url}
              placeholder="https://shopmy.us/shop/justbobbidotcom"
              onChange={(e) => setS({ ...s, url: e.target.value })}
            />
          </div>
          <p className="admin-form-hint">
            All three shapes work: <code>/shop/&lt;username&gt;</code>, the bare
            {' '}<code>/&lt;username&gt;</code>, and <code>/shop?Curator_id=&lt;digits&gt;</code>.
          </p>
        </>
      )}

      {s.step === 2 && (
        <>
          {existing === 'update' && (
            <p className="admin-form-hint">Already imported — this run will update that creator.</p>
          )}
          {existing === 'conflict' && (
            <div className="admin-form-error">
              <strong>{s.handle}</strong> already belongs to a creator who did not come from ShopMy.
              Choose a different handle — importing over them would replace their name, avatar and bio.
            </div>
          )}
          <div className="admin-form-group">
            <label htmlFor="shopmy-handle">Handle</label>
            <input id="shopmy-handle" type="text" value={s.handle}
                   onChange={(e) => setS({ ...s, handle: e.target.value })} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="shopmy-name">Display name</label>
            <input id="shopmy-name" type="text" value={s.displayName}
                   onChange={(e) => setS({ ...s, displayName: e.target.value })} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="shopmy-bio">Bio</label>
            <textarea id="shopmy-bio" rows={3} value={s.bio}
                      onChange={(e) => setS({ ...s, bio: e.target.value })} />
          </div>
        </>
      )}

      {s.step === 3 && (
        <>
          <p className="admin-form-hint">
            Untick anything that is not fashion — those pins are never fetched.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th /><th>Section</th><th>Collections</th><th>Pins</th></tr></thead>
              <tbody>
                {s.sections.map((sec) => (
                  <tr key={sec.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={sec.title}
                        checked={s.selectedSections.includes(sec.id)}
                        onChange={() => setS(toggleSection(s, sec.id))}
                      />
                    </td>
                    <td>{sec.title}</td>
                    <td>{sec.collections}</td>
                    <td>{sec.pins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {blocked && <p className="admin-form-hint">{blocked}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {s.step > 1 && (
          <button className="admin-btn admin-btn-secondary" disabled={busy}
                  onClick={() => setS({ ...s, step: (s.step - 1) as WizardState['step'] })}>
            Back
          </button>
        )}
        <button
          className="admin-btn admin-btn-primary"
          disabled={busy || blocked !== null || existing === 'conflict'}
          onClick={() => {
            if (s.step === 1) return void resolve();
            if (s.step === 2) return void countSections();
            setS({ ...s, step: 4 });
          }}
        >
          {busy ? 'Reading the shop…' : s.step === 3 ? 'Preview import' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

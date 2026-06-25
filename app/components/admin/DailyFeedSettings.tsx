// Daily Feed — settings panel (all dials + the feed rulebook).
//
// The control surface for the per-shopper Daily Feed: master on/off,
// frequency, refresh hour, holdout %, history window, min signal, and the
// ten weighted Feed Rules. Extracted from the old "Automatic Editor" modal
// that lived on /admin/catalogs so the Daily Feed has its own dedicated
// admin page. Writes each change straight to app_settings via
// setAutoEditorConfig / setFeedRules and shows an inline saved/err flash.
//
// "Daily Feed" is the canonical name for this concept — see docs/daily-feed.md.

import { useCallback, useEffect, useRef, useState } from 'react';
import WeightDial from '~/components/admin/WeightDial';
import {
  getAutoEditorConfig, setAutoEditorConfig, advanceDailyFeed,
  DEFAULT_AUTO_EDITOR_CONFIG, type AutoEditorConfig,
  getFeedRules, setFeedRules,
  getFeedRulesOrder, setFeedRulesOrder,
  DEFAULT_FEED_RULES, FEED_RULE_META, type FeedRules,
} from '~/services/dials';

// Per-field context shown on hover via a "?" dot, so the row of dials stays
// compact instead of carrying a paragraph under each input.
const FIELD_HELP: Record<string, string> = {
  frequency: 'How often each shopper’s feed re-ranks — once a day, or fresh on every sign-in.',
  refreshHour: 'The hour (UTC) the Daily Feed rolls over to a new drop each day.',
  holdoutPct: 'Share of shoppers deliberately kept on the global feed as a control group for measurement.',
  recencyDays: 'How many days of a shopper’s activity the personalization looks back over.',
  minSignal: 'Minimum engagement events a shopper needs before they get a personalized feed (below this, the global feed).',
};

// "?" affordance with a real hover/focus tooltip (styled bubble via
// daily-feed-admin.css) so the product-insight copy shows instantly instead of
// relying on the slow, unstyled native title.
function HelpDot({ text }: { text: string }) {
  return (
    <span className="df-help" tabIndex={0} aria-label={text}>
      ?
      <span className="df-help-tip" role="tooltip">{text}</span>
    </span>
  );
}

export default function DailyFeedSettings() {
  const [config, setConfig] = useState<AutoEditorConfig>(DEFAULT_AUTO_EDITOR_CONFIG);
  const [rules, setRules] = useState<FeedRules>(DEFAULT_FEED_RULES);
  const [ruleOrder, setRuleOrder] = useState<(keyof FeedRules)[]>(FEED_RULE_META.map(m => m.key));
  const [dragKey, setDragKey] = useState<keyof FeedRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  // Inline saved/err flash (replaces the page-level toast the modal used).
  const [flash, setFlash] = useState<{ msg: string; err: boolean } | null>(null);
  const flashTimer = useRef(0);
  const say = useCallback((msg: string, err = false) => {
    setFlash({ msg, err });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2400);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAutoEditorConfig(), getFeedRules(), getFeedRulesOrder()])
      .then(([c, r, o]) => { if (!cancelled) { setConfig(c); setRules(r); setRuleOrder(o); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Drag-to-reorder the rules. Reorder live on drag-over for a smooth feel;
  // persist the arrangement on drop (it's presentational — the engine applies
  // every enabled rule in its own fixed pipeline regardless of this order).
  const reorder = useCallback((from: keyof FeedRules, to: keyof FeedRules) => {
    setRuleOrder(prev => {
      if (from === to) return prev;
      const next = prev.filter(k => k !== from);
      const idx = next.indexOf(to);
      if (idx < 0) return prev;
      next.splice(idx, 0, from);
      return next;
    });
  }, []);
  const persistOrder = useCallback((order: (keyof FeedRules)[]) => {
    setFeedRulesOrder(order).catch(err => say(`Save failed: ${err instanceof Error ? err.message : String(err)}`, true));
  }, [say]);

  // Debounced rule persistence — sliders fire fast; write once settled.
  const ruleSaveTimer = useRef(0);
  const saveRules = useCallback((next: FeedRules) => {
    setRules(next);
    window.clearTimeout(ruleSaveTimer.current);
    ruleSaveTimer.current = window.setTimeout(() => {
      setFeedRules(next)
        .then(() => say('Feed rules saved'))
        .catch(err => say(`Save failed: ${err instanceof Error ? err.message : String(err)}`, true));
    }, 450);
  }, [say]);

  // Persist a partial change immediately (optimistic local update).
  const save = useCallback(async (partial: Partial<AutoEditorConfig>) => {
    setConfig(prev => ({ ...prev, ...partial }));
    setSaving(true);
    try {
      await setAutoEditorConfig(partial);
      say('Daily Feed settings saved');
    } catch (err) {
      say(`Save failed: ${err instanceof Error ? err.message : String(err)}`, true);
      getAutoEditorConfig().then(setConfig).catch(() => {});
    } finally {
      setSaving(false);
    }
  }, [say]);

  // Force-advance EVERY shopper to their next Daily Feed now (bumps the global
  // epoch — the edge fn shifts the feed day forward, the client cache key folds
  // it in, so the new order shows immediately instead of at the next rollover).
  const advance = useCallback(async () => {
    if (!window.confirm(
      'Advance the Daily Feed for EVERY shopper to their next feed right now?\n\n'
      + 'This re-rolls everyone’s order immediately (no waiting for the daily rollover).',
    )) return;
    setAdvancing(true);
    try {
      const next = await advanceDailyFeed();
      setConfig(prev => ({ ...prev, epoch: next }));
      say('Advanced — every shopper is on their next feed');
    } catch (err) {
      say(`Advance failed: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setAdvancing(false);
    }
  }, [say]);

  const fieldLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#475569',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6,
    display: 'flex', alignItems: 'center',
  };
  const numInput: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700 }}>Settings &amp; dials</h2>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
            Each signed-in shopper&apos;s custom feed, re-ranked to their taste once per day.
            When on, every shopper gets their own Daily Feed; off keeps everyone on the global feed order.
          </p>
        </div>
      </div>

      {/* Master on/off toggle. */}
      <label
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '12px 14px', borderRadius: 8, border: '1px solid #e2e8f0',
          background: config.enabled ? '#ecfdf5' : '#f8fafc', cursor: loading ? 'default' : 'pointer',
          marginBottom: 18,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
          Daily Feed — personalized per shopper
        </span>
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={loading || saving}
          onChange={e => save({ enabled: e.target.checked })}
          style={{ width: 18, height: 18, cursor: 'pointer' }}
        />
      </label>

      {/* Tuning — only meaningful while the master flag is on. */}
      <fieldset
        disabled={!config.enabled || loading || saving}
        style={{
          border: 'none', padding: 0, margin: 0,
          opacity: config.enabled ? 1 : 0.5,
          display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: '1 1 150px', minWidth: 140 }}>
          <label style={fieldLabel}>Frequency<HelpDot text={FIELD_HELP.frequency} /></label>
          <select
            value={config.frequency}
            onChange={e => save({ frequency: e.target.value as AutoEditorConfig['frequency'] })}
            style={{ ...numInput, cursor: 'pointer', appearance: 'none' }}
          >
            <option value="daily">Daily</option>
            <option value="every_signin">Every sign-in</option>
          </select>
        </div>

        {config.frequency === 'daily' && (
          <div style={{ flex: '1 1 150px', minWidth: 140 }}>
            <label style={fieldLabel}>Refresh time (UTC)<HelpDot text={FIELD_HELP.refreshHour} /></label>
            <input
              type="time"
              step={3600}
              value={`${String(config.refreshHour).padStart(2, '0')}:00`}
              onChange={e => {
                const hh = parseInt((e.target.value || '00:00').split(':')[0], 10);
                save({ refreshHour: Number.isFinite(hh) ? hh : 0 });
              }}
              style={numInput}
            />
            <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
              Rolls over at {String(config.refreshHour).padStart(2, '0')}:00 UTC each day.
            </div>
          </div>
        )}

        <div style={{ flex: '1 1 150px', minWidth: 140 }}>
          <label style={fieldLabel}>Holdout %<HelpDot text={FIELD_HELP.holdoutPct} /></label>
          <input
            type="number" min={0} max={100}
            value={config.holdoutPct}
            onChange={e => save({ holdoutPct: Number(e.target.value) })}
            style={numInput}
          />
        </div>

        <div style={{ flex: '1 1 150px', minWidth: 140 }}>
          <label style={fieldLabel}>History (days)<HelpDot text={FIELD_HELP.recencyDays} /></label>
          <input
            type="number" min={1} max={365}
            value={config.recencyDays}
            onChange={e => save({ recencyDays: Number(e.target.value) })}
            style={numInput}
          />
        </div>

        <div style={{ flex: '1 1 150px', minWidth: 140 }}>
          <label style={fieldLabel}>Min signal<HelpDot text={FIELD_HELP.minSignal} /></label>
          <input
            type="number" min={0} max={1000}
            value={config.minSignal}
            onChange={e => save({ minSignal: Number(e.target.value) })}
            style={numInput}
          />
        </div>
      </fieldset>

      {/* ── Manual advance: roll EVERY shopper to their next feed now ──── */}
      <div
        style={{
          marginTop: 18, padding: 14, borderRadius: 8, border: '1px solid #e2e8f0',
          background: '#f8fafc', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Advance to next daily feed</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            Roll <strong>every shopper</strong> to their next Daily Feed right now — a fresh
            order for all users, without waiting for the {String(config.refreshHour).padStart(2, '0')}:00 UTC rollover.
          </div>
        </div>
        <button
          type="button"
          onClick={advance}
          disabled={loading || advancing || !config.enabled}
          title={config.enabled ? 'Advance the Daily Feed for all users' : 'Turn the Daily Feed on first'}
          style={{
            flexShrink: 0, padding: '9px 16px', borderRadius: 8, border: 'none',
            background: (config.enabled && !advancing && !loading) ? '#111' : '#cbd5e1',
            color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: (config.enabled && !advancing && !loading) ? 'pointer' : 'default',
          }}
        >
          {advancing ? 'Advancing…' : 'Advance →'}
        </button>
      </div>

      {/* ── The daily feed rulebook ──────────────────────────────────── */}
      <div style={{ marginTop: 22, borderTop: '1px solid #eee', paddingTop: 16 }}>
        <h3 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>Daily feed rules</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888' }}>
          The rulebook behind every shopper&apos;s Daily Feed. Each rule is a switch + a weight
          (how hard it pulls). Drag the handle to reorder; hover the&nbsp;? for what each does.
        </p>
        {/* Gallery view — a grid of rule cards (was a tall single column). */}
        <div className="df-rules-gallery">
          {ruleOrder.map(key => {
            const meta = FEED_RULE_META.find(m => m.key === key);
            if (!meta) return null;
            const rule = rules[meta.key];
            const isDragging = dragKey === meta.key;
            return (
              <div
                key={meta.key}
                className={`df-rule-card${rule.enabled ? ' is-on' : ''}${isDragging ? ' is-dragging' : ''}`}
                onDragOver={e => { if (dragKey && dragKey !== meta.key) { e.preventDefault(); reorder(dragKey, meta.key); } }}
              >
                <div className="df-rule-card-head">
                  <span
                    className="df-rule-card-grip"
                    draggable={!loading}
                    onDragStart={() => setDragKey(meta.key)}
                    onDragEnd={() => { setDragKey(null); persistOrder(ruleOrder); }}
                    title="Drag to reorder"
                    aria-label="Drag to reorder"
                  >⠿</span>
                  <span className="df-rule-card-title">{meta.label}<HelpDot text={meta.hint} /></span>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={loading}
                    onChange={e => saveRules({ ...rules, [meta.key]: { ...rule, enabled: e.target.checked } })}
                    style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0, marginTop: 1 }}
                  />
                </div>
                <div className="df-rule-card-foot">
                  {meta.weight ? (
                    <div className="df-rule-card-dial" style={{ opacity: rule.enabled ? 1 : 0.4 }}>
                      <WeightDial
                        value={rule.weight}
                        min={meta.min ?? 0}
                        max={meta.max ?? 10}
                        step={1}
                        disabled={loading || !rule.enabled}
                        onChange={n => saveRules({ ...rules, [meta.key]: { ...rule, weight: n } })}
                      />
                      <span className="df-rule-card-dial-scale" aria-hidden="true"><span>low</span><span>high</span></span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>{rule.enabled ? 'On' : 'Off'}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Saved notification — a success-check toast (Transitions.dev) fires on
          every save: settings, rule changes, and the advance action all funnel
          through say(), so any "set" shows this with its context message. */}
      {flash && (
        <div className={`df-save-toast${flash.err ? ' is-err' : ''}`} role="status" aria-live="polite">
          <span className="df-save-toast-icon">
            <span className="t-success-check" data-state="in" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                {flash.err ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M20 6 9 17l-5-5" />}
              </svg>
            </span>
          </span>
          <div>
            <div className="df-save-toast-title">{flash.err ? 'Couldn’t save' : 'Saved'}</div>
            <div className="df-save-toast-sub">{flash.msg}</div>
          </div>
        </div>
      )}
    </div>
  );
}

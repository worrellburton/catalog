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
import {
  getAutoEditorConfig, setAutoEditorConfig,
  DEFAULT_AUTO_EDITOR_CONFIG, type AutoEditorConfig,
  getFeedRules, setFeedRules,
  DEFAULT_FEED_RULES, FEED_RULE_META, type FeedRules,
} from '~/services/dials';

export default function DailyFeedSettings() {
  const [config, setConfig] = useState<AutoEditorConfig>(DEFAULT_AUTO_EDITOR_CONFIG);
  const [rules, setRules] = useState<FeedRules>(DEFAULT_FEED_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
    Promise.all([getAutoEditorConfig(), getFeedRules()])
      .then(([c, r]) => { if (!cancelled) { setConfig(c); setRules(r); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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

  const fieldLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#475569',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block',
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
        {flash && (
          <span style={{
            flexShrink: 0, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
            background: flash.err ? '#fef2f2' : '#ecfdf5', color: flash.err ? '#b91c1c' : '#047857',
          }}>{flash.msg}</span>
        )}
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
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16,
        }}
      >
        <div>
          <label style={fieldLabel}>Frequency</label>
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
          <div>
            <label style={fieldLabel}>Refresh time (UTC)</label>
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

        <div>
          <label style={fieldLabel}>Holdout % (kept on the global feed)</label>
          <input
            type="number" min={0} max={100}
            value={config.holdoutPct}
            onChange={e => save({ holdoutPct: Number(e.target.value) })}
            style={numInput}
          />
        </div>

        <div>
          <label style={fieldLabel}>History window (days)</label>
          <input
            type="number" min={1} max={365}
            value={config.recencyDays}
            onChange={e => save({ recencyDays: Number(e.target.value) })}
            style={numInput}
          />
        </div>

        <div>
          <label style={fieldLabel}>Min signal (events before personalizing)</label>
          <input
            type="number" min={0} max={1000}
            value={config.minSignal}
            onChange={e => save({ minSignal: Number(e.target.value) })}
            style={numInput}
          />
        </div>
      </fieldset>

      {/* ── The daily feed rulebook ──────────────────────────────────── */}
      <div style={{ marginTop: 22, borderTop: '1px solid #eee', paddingTop: 16 }}>
        <h3 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>Daily feed rules</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888' }}>
          The rulebook behind every shopper&apos;s Daily Feed. Each rule is a switch + a weight
          (how hard it pulls). Defaults match today&apos;s behavior.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FEED_RULE_META.map(meta => {
            const rule = rules[meta.key];
            return (
              <div
                key={meta.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                  background: rule.enabled ? '#f0fdf4' : '#fafafa',
                }}
              >
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={loading}
                  onChange={e => saveRules({ ...rules, [meta.key]: { ...rule, enabled: e.target.checked } })}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#111' }}>{meta.label}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{meta.hint}</div>
                </div>
                {meta.weight && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, opacity: rule.enabled ? 1 : 0.35 }}>
                    <input
                      type="range"
                      min={meta.min ?? 0}
                      max={meta.max ?? 10}
                      step={1}
                      value={rule.weight}
                      disabled={loading || !rule.enabled}
                      onChange={e => saveRules({ ...rules, [meta.key]: { ...rule, weight: Number(e.target.value) } })}
                      style={{ width: 90 }}
                    />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', width: 18, textAlign: 'right' }}>{rule.weight}</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// PromptSettingsModal — global settings panel opened from the admin
// Data toolbar. Surfaces the editable AI prompts (Polish Primary,
// Primary Video) and persists changes to the app_settings table so the
// matching edge functions pick them up on their next run. Add a new
// row by extending EDITABLE_PROMPTS in app/constants/ai-prompts.ts.

import { useEffect, useState, useCallback } from 'react';
import { EDITABLE_PROMPTS } from '~/constants/ai-prompts';
import { getAppSetting, setAppSetting } from '~/services/app-settings';

interface PromptSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (message: string) => void;
}

export default function PromptSettingsModal({ open, onClose, onSaved }: PromptSettingsModalProps) {
  // key → current textarea value. Seeded from app_settings on open,
  // falling back to each prompt's default when no row exists yet.
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current values every time the modal opens so it always
  // reflects what the edge functions will actually use.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const entries = await Promise.all(
        EDITABLE_PROMPTS.map(async (p) => {
          const stored = await getAppSetting(p.key);
          return [p.key, (stored ?? p.defaultValue)] as const;
        }),
      );
      if (cancelled) return;
      setValues(Object.fromEntries(entries));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    const results = await Promise.all(
      EDITABLE_PROMPTS.map((p) => setAppSetting(p.key, (values[p.key] ?? '').trim() || p.defaultValue)),
    );
    setSaving(false);
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      setError(firstErr);
      return;
    }
    onSaved?.('Prompts saved — new runs will use them.');
    onClose();
  }, [values, onSaved, onClose]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '48px 16px', overflowY: 'auto',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: '#fff', borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px', borderBottom: '1px solid #f1f5f9',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Settings</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#64748b' }}>
              Editable AI prompts. Changes apply to the next run of each pipeline.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid #e5e7eb',
              background: '#fff', color: '#475569', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading prompts…</div>
          ) : (
            EDITABLE_PROMPTS.map((p) => {
              const value = values[p.key] ?? '';
              const isDefault = value.trim() === p.defaultValue.trim();
              return (
                <div key={p.key}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                    <label htmlFor={`prompt-${p.key}`} style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                      {p.label}
                    </label>
                    <button
                      type="button"
                      disabled={isDefault}
                      onClick={() => setValues((v) => ({ ...v, [p.key]: p.defaultValue }))}
                      style={{
                        fontSize: 11.5, fontWeight: 600,
                        color: isDefault ? '#cbd5e1' : '#7c3aed',
                        background: 'none', border: 'none', padding: 0,
                        cursor: isDefault ? 'default' : 'pointer',
                      }}
                    >
                      Reset to default
                    </button>
                  </div>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>{p.description}</p>
                  <textarea
                    id={`prompt-${p.key}`}
                    value={value}
                    onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                    rows={5}
                    spellCheck={false}
                    style={{
                      width: '100%', resize: 'vertical', minHeight: 96,
                      padding: '10px 12px', borderRadius: 10,
                      border: '1px solid #e2e8f0', background: '#f8fafc',
                      fontSize: 13, lineHeight: 1.5, color: '#0f172a',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    }}
                  />
                </div>
              );
            })
          )}
          {error && (
            <div style={{ fontSize: 12.5, color: '#dc2626', fontWeight: 600 }}>Save failed: {error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 22px', borderTop: '1px solid #f1f5f9', background: '#fafafa',
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '9px 16px', borderRadius: 9, border: '1px solid #e5e7eb',
              background: '#fff', color: '#334155', fontSize: 13, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            style={{
              padding: '9px 18px', borderRadius: 9, border: 'none',
              background: saving ? '#a78bfa' : '#7c3aed', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: saving || loading ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

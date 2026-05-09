import { useEffect, useState } from 'react';
import {
  getAppSetting,
  setAppSetting,
  DEFAULT_STYLE_PROMPT,
  STYLE_PROMPT_KEY,
} from '~/services/app-settings';

/**
 * Admin → Prompts. Each section binds a foundational prompt stored in
 * `app_settings`. Today only the Style prompt lives here; future prompts
 * (look description, taxonomy, etc.) can drop in as additional sections.
 */
export default function AdminPrompts() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Prompts</h1>
        <p className="admin-page-subtitle">
          Foundational prompts that power generative features. Edits here
          immediately apply to every user.
        </p>
      </div>
      <PromptSection
        settingKey={STYLE_PROMPT_KEY}
        defaultValue={DEFAULT_STYLE_PROMPT}
        title="Style prompt"
        description="Used by the /style page when a shopper asks to be styled for a specific occasion. Substituted placeholders: {{gender}}, {{name}}, {{height}}, {{age}}, {{pronoun}} (and {{pronoun}}'s for the contracted form), {{occasion}}."
      />
    </div>
  );
}

interface PromptSectionProps {
  settingKey: string;
  defaultValue: string;
  title: string;
  description: string;
}

function PromptSection({ settingKey, defaultValue, title, description }: PromptSectionProps) {
  const [loading, setLoading] = useState(true);
  const [savedValue, setSavedValue] = useState<string>(defaultValue);
  const [draftValue, setDraftValue] = useState<string>(defaultValue);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppSetting(settingKey).then(value => {
      if (cancelled) return;
      const resolved = value ?? defaultValue;
      setSavedValue(resolved);
      setDraftValue(resolved);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [settingKey, defaultValue]);

  async function handleSave() {
    setSaving(true);
    setStatus('idle');
    setErrorMsg(null);
    const { error } = await setAppSetting(settingKey, draftValue);
    setSaving(false);
    if (error) {
      setStatus('error');
      setErrorMsg(error);
      return;
    }
    setSavedValue(draftValue);
    setStatus('saved');
    window.setTimeout(() => setStatus('idle'), 2500);
  }

  function handleReset() {
    setDraftValue(defaultValue);
    setStatus('idle');
  }

  const isDirty = draftValue !== savedValue;

  return (
    <div className="admin-settings-section">
      <h2 className="admin-settings-heading">{title}</h2>
      <p className="admin-settings-desc">{description}</p>

      <textarea
        className="admin-prompts-textarea"
        value={draftValue}
        onChange={e => { setDraftValue(e.target.value); setStatus('idle'); }}
        disabled={loading || saving}
        rows={6}
        spellCheck={false}
        style={{
          width: '100%',
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.12)',
          background: '#fff',
          color: '#111',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          lineHeight: 1.5,
          resize: 'vertical',
          minHeight: 140,
        }}
      />

      <div className="admin-settings-actions" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="admin-btn admin-btn-primary"
          onClick={handleSave}
          disabled={saving || loading || !isDirty}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="admin-btn"
          onClick={handleReset}
          disabled={saving || loading || draftValue === defaultValue}
          type="button"
        >
          Reset to default
        </button>
        {status === 'saved' && (
          <span className="admin-settings-status admin-settings-status--ok">Saved</span>
        )}
        {status === 'error' && (
          <span className="admin-settings-status admin-settings-status--err">
            {errorMsg ?? 'Save failed — check Supabase RLS policies'}
          </span>
        )}
      </div>
    </div>
  );
}

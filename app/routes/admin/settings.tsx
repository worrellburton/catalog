import { useEffect, useState } from 'react';
import { supabase } from '../../utils/supabase';
import { VIDEO_MODELS } from '../../constants/video-models';

const LOOK_MODEL_KEY = 'look_video_model';

export default function AdminSettings() {
  const [currentModel, setCurrentModel] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', LOOK_MODEL_KEY)
      .single()
      .then(({ data }) => {
        const val = data?.value ?? 'fal-ai/veo3.1/fast/image-to-video';
        setCurrentModel(val);
        setSelectedModel(val);
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveStatus('idle');
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: LOOK_MODEL_KEY, value: selectedModel, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) {
      setSaveStatus('error');
    } else {
      setCurrentModel(selectedModel);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    }
  }

  const isDirty = selectedModel !== currentModel;

  // Only show models marked as usable in the picker.
  const usableModels = VIDEO_MODELS.filter(m => m.usable);
  const groups = Array.from(new Set(usableModels.map(m => m.group)));

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Settings</h1>
        <p className="admin-page-subtitle">Platform configuration</p>
      </div>

      <div className="admin-settings-section">
        <h2 className="admin-settings-heading">Look Generator</h2>
        <p className="admin-settings-desc">
          The video model used when generating looks for shoppers. Switch away from Seedance if
          ByteDance's content filter is blocking face references.
        </p>

        <div className="admin-settings-row">
          <label className="admin-settings-label" htmlFor="look-model-select">
            Video model
          </label>
          <select
            id="look-model-select"
            className="admin-settings-select"
            value={selectedModel}
            onChange={e => { setSelectedModel(e.target.value); setSaveStatus('idle'); }}
            disabled={saving}
          >
            {groups.map(group => (
              <optgroup key={group} label={group}>
                {usableModels.filter(m => m.group === group).map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="admin-settings-actions">
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleSave}
            disabled={saving || !isDirty}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saveStatus === 'saved' && (
            <span className="admin-settings-status admin-settings-status--ok">Saved</span>
          )}
          {saveStatus === 'error' && (
            <span className="admin-settings-status admin-settings-status--err">
              Save failed - check Supabase RLS policies
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

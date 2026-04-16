import { useState, useEffect, useCallback } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { getAiModels, createAiModel, updateAiModel, deleteAiModel, uploadFaceImage } from '~/services/ai-models';
import type { AiModel, AiModelFormData } from '~/services/ai-models';

const STYLE_OPTIONS = [
  { value: 'editorial_runway', label: 'Editorial Runway' },
  { value: 'street_style', label: 'Street Style' },
  { value: 'studio_clean', label: 'Studio Clean' },
  { value: 'lifestyle_context', label: 'Lifestyle Context' },
];

const GENDER_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non_binary', label: 'Non-binary' },
];

const AGE_RANGE_OPTIONS = [
  { value: '18-25', label: '18–25' },
  { value: '26-35', label: '26–35' },
  { value: '36-45', label: '36–45' },
  { value: '46+', label: '46+' },
];

const emptyForm: AiModelFormData = {
  name: '',
  slug: '',
  gender: 'female',
  ethnicity: '',
  age_range: '18-25',
  bio: '',
  face_images: [],
  primary_image: '',
  default_style: 'editorial_runway',
  style_presets: ['editorial_runway'],
  persona_prompt: '',
  status: 'active',
  enabled: true,
};

export default function AdminAiModels() {
  const [models, setModels] = useState<AiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AiModelFormData>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { sortedData, sort, handleSort } = useSortableTable(models);

  const loadModels = useCallback(async () => {
    setLoading(true);
    const data = await getAiModels();
    setModels(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setError(null);
    setShowModal(true);
  };

  const openEdit = (model: AiModel) => {
    setEditingId(model.id);
    setForm({
      name: model.name,
      slug: model.slug,
      gender: model.gender,
      ethnicity: model.ethnicity || '',
      age_range: model.age_range || '18-25',
      bio: model.bio || '',
      face_images: model.face_images || [],
      primary_image: model.primary_image || '',
      default_style: model.default_style,
      style_presets: model.style_presets || ['editorial_runway'],
      persona_prompt: model.persona_prompt || '',
      status: model.status,
      enabled: model.enabled,
    });
    setError(null);
    setShowModal(true);
  };

  const handleNameChange = (name: string) => {
    setForm(prev => ({
      ...prev,
      name,
      slug: editingId ? prev.slug : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    }));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !form.slug) return;

    setUploading(true);
    const newImages = [...(form.face_images || [])];

    for (let i = 0; i < files.length; i++) {
      const { url, error: uploadError } = await uploadFaceImage(files[i], form.slug || 'temp');
      if (url) {
        newImages.push(url);
      } else if (uploadError) {
        setError(uploadError);
      }
    }

    setForm(prev => ({
      ...prev,
      face_images: newImages,
      primary_image: prev.primary_image || newImages[0] || '',
    }));
    setUploading(false);
  };

  const removeImage = (index: number) => {
    setForm(prev => {
      const images = [...(prev.face_images || [])];
      const removed = images.splice(index, 1)[0];
      return {
        ...prev,
        face_images: images,
        primary_image: prev.primary_image === removed ? (images[0] || '') : prev.primary_image,
      };
    });
  };

  const setPrimaryImage = (url: string) => {
    setForm(prev => ({ ...prev, primary_image: url }));
  };

  const toggleStylePreset = (style: string) => {
    setForm(prev => {
      const presets = prev.style_presets || [];
      const updated = presets.includes(style)
        ? presets.filter(s => s !== style)
        : [...presets, style];
      return { ...prev, style_presets: updated.length ? updated : [style] };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.slug.trim()) { setError('Slug is required'); return; }

    setSaving(true);
    setError(null);

    if (editingId) {
      const { error: err } = await updateAiModel(editingId, form);
      if (err) { setError(err); setSaving(false); return; }
    } else {
      const { error: err } = await createAiModel(form);
      if (err) { setError(err); setSaving(false); return; }
    }

    setSaving(false);
    setShowModal(false);
    loadModels();
  };

  const handleArchive = async (id: string) => {
    await deleteAiModel(id);
    loadModels();
  };

  const stats = [
    { label: 'Total Models', value: String(models.length) },
    { label: 'Active', value: String(models.filter(m => m.status === 'active').length) },
    { label: 'Total Looks', value: String(models.reduce((sum, m) => sum + m.looks_count, 0)) },
    { label: 'Total Followers', value: String(models.reduce((sum, m) => sum + m.followers_count, 0)) },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>AI Models</h1>
          <p className="admin-page-subtitle">Manage virtual models for AI-generated looks</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={openCreate}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Model
        </button>
      </div>

      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="admin-empty">Loading models…</div>
      ) : models.length === 0 ? (
        <div className="admin-empty">No AI models yet. Create your first model to get started.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <SortableTh label="Model" sortKey="name" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Gender" sortKey="gender" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Age" sortKey="age_range" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Default Style" sortKey="default_style" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Looks" sortKey="looks_count" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Followers" sortKey="followers_count" currentSort={sort} onSort={handleSort} />
                <SortableTh label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map((m) => (
                <tr key={m.id} className="admin-clickable-row" onClick={() => openEdit(m)}>
                  <td className="admin-cell-name">
                    {m.primary_image ? (
                      <img
                        src={m.primary_image}
                        alt={m.name}
                        style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', marginRight: 8 }}
                      />
                    ) : (
                      <span className="admin-user-avatar" style={{ background: '#e3f2fd' }}>
                        {m.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <div>{m.name}</div>
                      <div style={{ fontSize: 11, color: '#999' }}>@{m.slug}</div>
                    </div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{m.gender.replace('_', '-')}</td>
                  <td>{m.age_range || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{m.default_style.replace(/_/g, ' ')}</td>
                  <td>{m.looks_count}</td>
                  <td>{m.followers_count}</td>
                  <td>
                    <span className={`admin-status admin-status-${m.status === 'active' ? 'online' : m.status === 'inactive' ? 'offline' : 'away'}`}>
                      {m.status}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 8px' }}
                      onClick={() => handleArchive(m.id)}
                    >
                      Archive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="admin-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="admin-modal admin-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>{editingId ? 'Edit Model' : 'New AI Model'}</h3>
              <button className="admin-modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="admin-modal-body">
              {error && <div className="admin-form-error" style={{ marginBottom: 12 }}>{error}</div>}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Left column */}
                <div>
                  <div className="admin-form-group">
                    <label>Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => handleNameChange(e.target.value)}
                      placeholder="e.g. Aria Rose"
                    />
                  </div>
                  <div className="admin-form-group">
                    <label>Slug / Handle</label>
                    <input
                      type="text"
                      value={form.slug}
                      onChange={e => setForm(prev => ({ ...prev, slug: e.target.value }))}
                      placeholder="aria-rose"
                      disabled={!!editingId}
                    />
                    <span className="admin-form-hint">Used as @handle — cannot be changed after creation</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="admin-form-group">
                      <label>Gender</label>
                      <select
                        value={form.gender}
                        onChange={e => setForm(prev => ({ ...prev, gender: e.target.value as AiModelFormData['gender'] }))}
                        style={selectStyle}
                      >
                        {GENDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="admin-form-group">
                      <label>Age Range</label>
                      <select
                        value={form.age_range || ''}
                        onChange={e => setForm(prev => ({ ...prev, age_range: e.target.value || undefined }))}
                        style={selectStyle}
                      >
                        <option value="">—</option>
                        {AGE_RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="admin-form-group">
                    <label>Ethnicity (optional)</label>
                    <input
                      type="text"
                      value={form.ethnicity || ''}
                      onChange={e => setForm(prev => ({ ...prev, ethnicity: e.target.value }))}
                      placeholder="e.g. East Asian, Black, Latina"
                    />
                  </div>
                  <div className="admin-form-group">
                    <label>Bio</label>
                    <textarea
                      value={form.bio || ''}
                      onChange={e => setForm(prev => ({ ...prev, bio: e.target.value }))}
                      placeholder="Short bio shown on their creator profile…"
                      rows={3}
                      style={textareaStyle}
                    />
                  </div>
                </div>

                {/* Right column */}
                <div>
                  <div className="admin-form-group">
                    <label>Face Reference Images</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {(form.face_images || []).map((url, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          <img
                            src={url}
                            alt={`Face ${i + 1}`}
                            style={{
                              width: 72, height: 72, borderRadius: 8, objectFit: 'cover',
                              border: url === form.primary_image ? '2px solid #111' : '2px solid #ddd',
                              cursor: 'pointer',
                            }}
                            onClick={() => setPrimaryImage(url)}
                            title="Click to set as primary"
                          />
                          <button
                            onClick={() => removeImage(i)}
                            style={{
                              position: 'absolute', top: -4, right: -4,
                              width: 18, height: 18, borderRadius: '50%',
                              background: '#ef4444', color: '#fff', border: 'none',
                              fontSize: 11, cursor: 'pointer', display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                            }}
                          >×</button>
                          {url === form.primary_image && (
                            <div style={{
                              position: 'absolute', bottom: 2, left: 2, right: 2,
                              background: 'rgba(0,0,0,0.7)', color: '#fff',
                              fontSize: 9, textAlign: 'center', borderRadius: '0 0 6px 6px',
                              padding: '1px 0',
                            }}>Primary</div>
                          )}
                        </div>
                      ))}
                      <label style={{
                        width: 72, height: 72, borderRadius: 8,
                        border: '2px dashed #ddd', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', fontSize: 24, color: '#ccc',
                      }}>
                        {uploading ? '…' : '+'}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          style={{ display: 'none' }}
                          onChange={handleImageUpload}
                          disabled={uploading}
                        />
                      </label>
                    </div>
                    <span className="admin-form-hint">Upload front, 3/4, and profile angles. Click to set primary.</span>
                  </div>

                  <div className="admin-form-group">
                    <label>Default Style</label>
                    <select
                      value={form.default_style || 'editorial_runway'}
                      onChange={e => setForm(prev => ({ ...prev, default_style: e.target.value }))}
                      style={selectStyle}
                    >
                      {STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div className="admin-form-group">
                    <label>Enabled Styles</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {STYLE_OPTIONS.map(o => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => toggleStylePreset(o.value)}
                          style={{
                            padding: '4px 10px', borderRadius: 14, fontSize: 12,
                            border: '1px solid',
                            borderColor: (form.style_presets || []).includes(o.value) ? '#111' : '#ddd',
                            background: (form.style_presets || []).includes(o.value) ? '#111' : 'transparent',
                            color: (form.style_presets || []).includes(o.value) ? '#fff' : '#666',
                            cursor: 'pointer',
                          }}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="admin-form-group">
                    <label>Persona Prompt (optional)</label>
                    <textarea
                      value={form.persona_prompt || ''}
                      onChange={e => setForm(prev => ({ ...prev, persona_prompt: e.target.value }))}
                      placeholder="Custom Veo persona description. Leave blank for auto-generated."
                      rows={3}
                      style={textareaStyle}
                    />
                    <span className="admin-form-hint">Override the default persona description for video generation</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Update' : 'Create Model'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
  outline: 'none',
  background: '#fff',
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
  outline: 'none',
  resize: 'vertical',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

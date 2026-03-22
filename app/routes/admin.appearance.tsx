import { useState } from 'react';

const fonts = [
  { name: 'Inter', family: "'Inter', sans-serif" },
  { name: 'DM Sans', family: "'DM Sans', sans-serif" },
  { name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans', sans-serif" },
  { name: 'Outfit', family: "'Outfit', sans-serif" },
  { name: 'Space Grotesk', family: "'Space Grotesk', sans-serif" },
  { name: 'Sora', family: "'Sora', sans-serif" },
  { name: 'Manrope', family: "'Manrope', sans-serif" },
  { name: 'Poppins', family: "'Poppins', sans-serif" },
  { name: 'Nunito Sans', family: "'Nunito Sans', sans-serif" },
  { name: 'Figtree', family: "'Figtree', sans-serif" },
];

const accentColors = [
  { name: 'Green', value: '#4caf50' },
  { name: 'Blue', value: '#2196f3' },
  { name: 'Purple', value: '#9c27b0' },
  { name: 'Orange', value: '#ff9800' },
  { name: 'Red', value: '#f44336' },
  { name: 'Teal', value: '#009688' },
  { name: 'Pink', value: '#e91e63' },
  { name: 'Indigo', value: '#3f51b5' },
];

const borderRadiusOptions = [
  { label: 'Sharp', value: '0px' },
  { label: 'Subtle', value: '4px' },
  { label: 'Rounded', value: '8px' },
  { label: 'Pill', value: '16px' },
];

const densityOptions = [
  { label: 'Compact', value: 'compact' },
  { label: 'Default', value: 'default' },
  { label: 'Comfortable', value: 'comfortable' },
];

export default function AdminAppearance() {
  const [selectedFont, setSelectedFont] = useState('Inter');
  const [selectedColor, setSelectedColor] = useState('#4caf50');
  const [selectedRadius, setSelectedRadius] = useState('8px');
  const [selectedDensity, setSelectedDensity] = useState('default');

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Appearance</h1>
        <p className="admin-page-subtitle">Customize the admin panel look and feel</p>
      </div>

      <div className="admin-appearance-grid">
        <div className="admin-appearance-section">
          <h3 className="admin-appearance-section-title">Font Family</h3>
          <p className="admin-appearance-section-desc">Choose a font for the admin interface</p>
          <div className="admin-font-grid">
            {fonts.map(f => (
              <button
                key={f.name}
                className={`admin-font-option ${selectedFont === f.name ? 'active' : ''}`}
                onClick={() => setSelectedFont(f.name)}
                style={{ fontFamily: f.family }}
              >
                <span className="admin-font-preview" style={{ fontFamily: f.family }}>Aa</span>
                <span className="admin-font-name">{f.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="admin-appearance-section">
          <h3 className="admin-appearance-section-title">Accent Color</h3>
          <p className="admin-appearance-section-desc">Primary color for buttons, toggles, and highlights</p>
          <div className="admin-color-grid">
            {accentColors.map(c => (
              <button
                key={c.value}
                className={`admin-color-option ${selectedColor === c.value ? 'active' : ''}`}
                onClick={() => setSelectedColor(c.value)}
              >
                <span className="admin-color-swatch" style={{ background: c.value }} />
                <span className="admin-color-name">{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="admin-appearance-section">
          <h3 className="admin-appearance-section-title">Border Radius</h3>
          <p className="admin-appearance-section-desc">Corner roundness for cards, buttons, and inputs</p>
          <div className="admin-radius-grid">
            {borderRadiusOptions.map(r => (
              <button
                key={r.value}
                className={`admin-radius-option ${selectedRadius === r.value ? 'active' : ''}`}
                onClick={() => setSelectedRadius(r.value)}
              >
                <div className="admin-radius-preview" style={{ borderRadius: r.value }} />
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="admin-appearance-section">
          <h3 className="admin-appearance-section-title">Density</h3>
          <p className="admin-appearance-section-desc">Spacing and padding across the interface</p>
          <div className="admin-radius-grid">
            {densityOptions.map(d => (
              <button
                key={d.value}
                className={`admin-radius-option ${selectedDensity === d.value ? 'active' : ''}`}
                onClick={() => setSelectedDensity(d.value)}
              >
                <div className="admin-density-preview">
                  {[...Array(d.value === 'compact' ? 4 : d.value === 'default' ? 3 : 2)].map((_, i) => (
                    <div key={i} className="admin-density-line" style={{ height: d.value === 'compact' ? 3 : d.value === 'default' ? 4 : 6 }} />
                  ))}
                </div>
                <span>{d.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="admin-appearance-preview-section">
        <h3 className="admin-appearance-section-title">Preview</h3>
        <div className="admin-appearance-preview" style={{ fontFamily: fonts.find(f => f.name === selectedFont)?.family, borderRadius: selectedRadius }}>
          <div className="admin-appearance-preview-header">
            <span style={{ fontWeight: 700, fontSize: 16 }}>Sample Card</span>
            <button className="admin-appearance-preview-btn" style={{ background: selectedColor, borderRadius: selectedRadius }}>Action</button>
          </div>
          <p style={{ fontSize: 13, color: '#666', margin: '8px 0 12px' }}>This is a preview of your selected appearance settings applied to a sample component.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="admin-appearance-preview-tag" style={{ borderRadius: selectedRadius }}>Tag One</div>
            <div className="admin-appearance-preview-tag" style={{ borderRadius: selectedRadius }}>Tag Two</div>
            <div className="admin-appearance-preview-tag" style={{ borderRadius: selectedRadius }}>Tag Three</div>
          </div>
        </div>
      </div>
    </div>
  );
}

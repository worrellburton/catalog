import { useState, useEffect } from 'react';
import { useNavigate } from '@remix-run/react';
import AnimatedBackground, { variants } from '~/components/AnimatedBackground';

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

export default function AdminAppearance() {
  const navigate = useNavigate();
  const [selectedFont, setSelectedFont] = useState(() => localStorage.getItem('admin-font') || 'Inter');
  const [selectedBg, setSelectedBg] = useState<number>(() => {
    const stored = localStorage.getItem('admin-bg');
    return stored !== null ? parseInt(stored) : -1;
  });

  // Apply font to the entire page when it changes
  useEffect(() => {
    const font = fonts.find(f => f.name === selectedFont);
    if (font) {
      document.documentElement.style.fontFamily = font.family;
      localStorage.setItem('admin-font', selectedFont);
    }
  }, [selectedFont]);

  // Persist background selection
  useEffect(() => {
    localStorage.setItem('admin-bg', selectedBg.toString());
    // Dispatch event so admin layout can pick up the change
    window.dispatchEvent(new CustomEvent('admin-bg-change', { detail: selectedBg }));
  }, [selectedBg]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Appearance</h1>
          <p className="admin-page-subtitle">Customize your platform experience</p>
        </div>
        <button className="partners-done-btn" onClick={() => navigate('/admin')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Done
        </button>
      </div>

      <div className="admin-appearance-section" style={{ marginBottom: 24 }}>
        <h3 className="admin-appearance-section-title">Font Family</h3>
        <p className="admin-appearance-section-desc">Choose a font for the entire platform — changes apply instantly</p>
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
        <h3 className="admin-appearance-section-title">Background</h3>
        <p className="admin-appearance-section-desc">Select an animated background for the main console</p>
        <div className="admin-bg-grid">
          <button
            className={`admin-bg-option ${selectedBg === -1 ? 'active' : ''}`}
            onClick={() => setSelectedBg(-1)}
          >
            <div className="admin-bg-preview" style={{ background: '#0a0a0a' }}>
              <span className="admin-bg-none-label">None</span>
            </div>
            <span className="admin-bg-name">Default</span>
          </button>
          {variants.map((v, i) => (
            <button
              key={i}
              className={`admin-bg-option ${selectedBg === i ? 'active' : ''}`}
              onClick={() => setSelectedBg(i)}
            >
              <div className="admin-bg-preview">
                <AnimatedBackground variant={i} preview />
              </div>
              <span className="admin-bg-name">{v.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

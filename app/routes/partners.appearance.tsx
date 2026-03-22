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

export default function PartnersAppearance() {
  const navigate = useNavigate();
  const [selectedFont, setSelectedFont] = useState(() => localStorage.getItem('partners-font') || 'Inter');
  const [selectedBg, setSelectedBg] = useState<number>(() => {
    const stored = localStorage.getItem('partners-bg');
    return stored !== null ? parseInt(stored) : -1;
  });

  useEffect(() => {
    const font = fonts.find(f => f.name === selectedFont);
    if (font) {
      document.documentElement.style.fontFamily = font.family;
      localStorage.setItem('partners-font', selectedFont);
    }
  }, [selectedFont]);

  useEffect(() => {
    localStorage.setItem('partners-bg', selectedBg.toString());
    window.dispatchEvent(new CustomEvent('partners-bg-change', { detail: selectedBg }));
  }, [selectedBg]);

  return (
    <div className="partners-page">
      <h2 className="partners-page-title">Appearance</h2>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -12, marginBottom: 24 }}>
        <p style={{ color: '#888', fontSize: 13, margin: 0 }}>Customize your brand console experience</p>
        <button className="partners-done-btn" onClick={() => navigate('/partners')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Done
        </button>
      </div>

      <div className="partners-section-card" style={{ marginBottom: 24 }}>
        <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Font Family</h3>
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

      <div className="partners-section-card">
        <h3 className="partners-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>Background</h3>
        <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>Select an animated background for your console</p>
        <div className="admin-bg-grid">
          <button
            className={`admin-bg-option ${selectedBg === -1 ? 'active' : ''}`}
            onClick={() => setSelectedBg(-1)}
          >
            <div className="admin-bg-preview" style={{ background: '#f8f8f8' }}>
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

'use client';

import { useState } from 'react';
import CatalogLogo from './CatalogLogo';

type Framework = 'nextjs' | 'remix' | 'java';

interface FrameworkSelectorProps {
  onSelect: (framework: Framework) => void;
}

const frameworks: { id: Framework; name: string; icon: string; desc: string; tech: string; color: string }[] = [
  {
    id: 'nextjs',
    name: 'Next.js',
    icon: '▲',
    desc: 'React framework with static export',
    tech: 'Next.js 16.2 · React 19 · TypeScript',
    color: '#0070f3',
  },
  {
    id: 'remix',
    name: 'Remix',
    icon: '💿',
    desc: 'Full stack web framework',
    tech: 'Remix 2 · React 19 · TypeScript',
    color: '#E8F44C',
  },
  {
    id: 'java',
    name: 'Java',
    icon: '☕',
    desc: 'Spring Boot with Thymeleaf templates',
    tech: 'Spring Boot 3 · Java 21 · Thymeleaf',
    color: '#ED8B00',
  },
];

export default function FrameworkSelector({ onSelect }: FrameworkSelectorProps) {
  const [hoveredId, setHoveredId] = useState<Framework | null>(null);
  const [selectedId, setSelectedId] = useState<Framework | null>(null);

  const handleSelect = (id: Framework) => {
    setSelectedId(id);
    setTimeout(() => onSelect(id), 400);
  };

  return (
    <div className="framework-selector">
      <div className="fw-content">
        <CatalogLogo className="fw-logo" />
        <p className="fw-subtitle">Choose your framework</p>
        <div className="fw-grid">
          {frameworks.map((fw) => (
            <button
              key={fw.id}
              className={`fw-card ${selectedId === fw.id ? 'fw-card-selected' : ''}`}
              onClick={() => handleSelect(fw.id)}
              onMouseEnter={() => setHoveredId(fw.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                '--fw-color': fw.color,
                borderColor: hoveredId === fw.id || selectedId === fw.id ? fw.color : 'rgba(255,255,255,0.1)',
              } as React.CSSProperties}
            >
              <span className="fw-icon">{fw.icon}</span>
              <span className="fw-name">{fw.name}</span>
              <span className="fw-desc">{fw.desc}</span>
              <span className="fw-tech">{fw.tech}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

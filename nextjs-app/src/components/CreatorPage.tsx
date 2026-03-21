'use client';

import { useEffect, useMemo } from 'react';
import { looks, creators, Look } from '@/data/looks';
import LookCard from './LookCard';

interface CreatorPageProps {
  creatorName: string;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
}

export default function CreatorPage({ creatorName, onClose, onOpenLook }: CreatorPageProps) {
  const creatorLooks = useMemo(() => looks.filter(l => l.creator === creatorName), [creatorName]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="creator-page">
      <button className="creator-back" onClick={onClose}>&larr; Back</button>
      <div className="creator-header">
        <h1>{creatorName}</h1>
        <p>{creatorLooks.length} looks</p>
      </div>
      <div className="creator-grid">
        {creatorLooks.map((look, i) => (
          <LookCard
            key={look.id}
            look={look}
            className="look-card"
            onOpenLook={onOpenLook}
            onOpenCreator={() => {}}
          />
        ))}
      </div>
    </div>
  );
}


import { useMemo } from 'react';
import { looks, Look } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import LookCard from './LookCard';

interface CreatorPageProps {
  creatorName: string;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
}

export default function CreatorPage({ creatorName, onClose, onOpenLook }: CreatorPageProps) {
  const creatorLooks = useMemo(() => looks.filter(l => l.creator === creatorName), [creatorName]);

  useEscapeKey(onClose);

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

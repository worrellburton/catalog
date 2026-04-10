
import CatalogLogo from './CatalogLogo';

interface DeckSelectorProps {
  onSelectDeck: (deckId: string) => void;
  onBack: () => void;
}

export default function DeckSelector({ onSelectDeck, onBack }: DeckSelectorProps) {
  return (
    <div className="deck-selector">
      <button className="deck-selector-back" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <div className="deck-selector-content">
        <CatalogLogo className="deck-selector-logo" />
        <p className="deck-selector-subtitle">Select a deck</p>
        <div className="deck-selector-grid">
          <button className="deck-selector-card" onClick={() => onSelectDeck('v8')}>
            <span className="deck-selector-version">V.8</span>
            <span className="deck-selector-label">Deck v.8</span>
            <span className="deck-selector-desc">Latest investor deck</span>
          </button>
          <button className="deck-selector-card deck-selector-card-muted" onClick={() => onSelectDeck('v7')}>
            <span className="deck-selector-version">V.7</span>
            <span className="deck-selector-label">Deck v.7</span>
            <span className="deck-selector-desc">Previous version</span>
          </button>
          <button className="deck-selector-card deck-selector-card-muted" onClick={() => onSelectDeck('v6')}>
            <span className="deck-selector-version">V.6</span>
            <span className="deck-selector-label">Deck v.6</span>
            <span className="deck-selector-desc">Earlier version</span>
          </button>
          <button className="deck-selector-card deck-selector-card-muted" onClick={() => onSelectDeck('v5')}>
            <span className="deck-selector-version">V.5</span>
            <span className="deck-selector-label">Deck v.5</span>
            <span className="deck-selector-desc">Original</span>
          </button>
        </div>
      </div>
    </div>
  );
}


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
          <button className="deck-selector-card" onClick={() => onSelectDeck('v6')}>
            <span className="deck-selector-version">V.6</span>
            <span className="deck-selector-label">Deck v.6</span>
            <span className="deck-selector-desc">Latest investor deck</span>
            <ol className="deck-selector-slides">
              <li>Intro</li>
              <li>The Problem</li>
              <li>The Insight</li>
              <li>The Solution</li>
              <li>Three-Sided Value</li>
              <li>Market Opportunity</li>
              <li>The Math</li>
              <li>Flywheel</li>
              <li>Why Now</li>
              <li>Traction</li>
              <li>The Ask</li>
            </ol>
          </button>
        </div>
      </div>
    </div>
  );
}

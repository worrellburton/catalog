
import { useState, useEffect } from 'react';

interface InAppBrowserProps {
  url: string;
  title: string;
  onClose: () => void;
}

export default function InAppBrowser({ url, title, onClose }: InAppBrowserProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsOpen(true));
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(onClose, 300);
  };

  return (
    <div className={`in-app-browser ${isOpen ? 'open' : ''}`}>
      <div className="iab-header">
        <button className="iab-back" onClick={handleClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to catalog
        </button>
        <span className="iab-title">{title}</span>
      </div>
      <iframe
        src={url}
        className="iab-frame"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}

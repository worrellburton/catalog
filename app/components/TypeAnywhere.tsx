import { useEffect, useState, useRef } from 'react';

/* Desktop-only "just start typing" search.
 *
 * No visible input chrome — the user begins typing anywhere and the
 * letters bloom in the middle of the screen. Enter fires the catalog
 * handler, Escape clears.
 *
 * Mobile (≤768px) keeps the BottomBar pill instead. We early-return
 * on touch / narrow viewports.
 */
interface Props {
  onSubmit: (query: string) => void;
}

const HELPER_HINTS = [
  'type anything',
  'try "omg shoes"',
  'try "date night"',
  'try "y2k denim"',
  'try "quiet luxury"',
  'try "off duty"',
];

export default function TypeAnywhere({ onSubmit }: Props) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(false);
  // Faint "type anywhere to search" hint at the top — shown until the
  // user has scrolled past a small threshold or has typed something.
  const [scrolled, setScrolled] = useState(false);
  const hideTimer = useRef<number | null>(null);
  // Stable hint per mount — rotating per keystroke would feel jittery.
  const hintRef = useRef(HELPER_HINTS[Math.floor(Math.random() * HELPER_HINTS.length)]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Mobile uses the BottomBar pill — type-anywhere only fires on
    // pointer-and-keyboard devices wide enough to have a header.
    const mql = window.matchMedia('(max-width: 768px)');
    if (mql.matches) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't intercept when the user is typing in a real form field
      // (search bar inside an overlay, password gate, admin pages).
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      // Ignore modifier-only and shortcut chords — Cmd+R, Ctrl+F, etc.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Enter') {
        const q = text.trim();
        if (!q) return;
        e.preventDefault();
        onSubmit(q);
        setText('');
        setActive(false);
        return;
      }
      if (e.key === 'Escape') {
        if (text || active) {
          e.preventDefault();
          setText('');
          setActive(false);
        }
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        setText(t => t.slice(0, -1));
        bumpActivity();
        return;
      }
      // Single printable character — letter, digit, space, punctuation.
      if (e.key.length === 1) {
        e.preventDefault();
        setText(t => (t + e.key).slice(0, 80));
        bumpActivity();
      }
    };

    const bumpActivity = () => {
      setActive(true);
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
      // Auto-fade after 6s of no input so the overlay never strands.
      hideTimer.current = window.setTimeout(() => {
        setActive(false);
        setText('');
      }, 6000);
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, [onSubmit, text, active]);

  const visible = active && text.length > 0;
  const hintVisible = !visible && !scrolled;

  return (
    <>
      {/* Faint top-of-grid hint. Fades out the moment the user
          scrolls past 80px or starts typing. */}
      <div
        className={`type-anywhere-toast ${hintVisible ? 'is-visible' : ''}`}
        aria-hidden={!hintVisible}
      >
        type anywhere to search
      </div>

      <div
        className={`type-anywhere ${visible ? 'is-visible' : ''}`}
        aria-hidden={!visible}
      >
        <div className="type-anywhere-text">
          <span className="type-anywhere-value">{text || hintRef.current}</span>
          <span className="type-anywhere-caret" aria-hidden="true" />
        </div>
        <div className="type-anywhere-hint">
          press <kbd>enter</kbd> to make a catalog · <kbd>esc</kbd> to clear
        </div>
      </div>
    </>
  );
}

import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from '@remix-run/react';

/* Desktop-only "just start typing" search.
 *
 * Mounted in root.tsx so it works on every page — type from a
 * brand page, /generate, /admin, /import, anywhere, hit Enter,
 * and we navigate back to / with ?q=<query> applied to the home
 * grid. Mobile (≤768px) keeps the BottomBar pill instead.
 */
const HELPER_HINTS = [
  'type anything',
  'try "omg shoes"',
  'try "date night"',
  'try "y2k denim"',
  'try "quiet luxury"',
  'try "off duty"',
];

export default function TypeAnywhere() {
  const navigate = useNavigate();
  const location = useLocation();
  const [text, setText] = useState('');
  const [active, setActive] = useState(false);
  // "type anywhere to search" hint pinned to viewport center. Starts
  // with a solid pill backdrop so the text stands out against the
  // grid; the moment the user moves the mouse (a signal they're
  // engaging with the page), the backdrop fades away. Scrolling past
  // a small threshold dismisses it entirely.
  const [scrolled, setScrolled] = useState(false);
  const [mouseMoved, setMouseMoved] = useState(false);
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
    if (mouseMoved) return;
    // First mousemove after mount kills the solid pill. We don't
    // re-arm — once the user has touched the page, they don't need
    // the bold prompt again this session.
    const onMove = () => setMouseMoved(true);
    window.addEventListener('mousemove', onMove, { passive: true, once: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [mouseMoved]);

  // Suppress on admin routes — admins are typing into form fields
  // constantly and the search overlay would interfere. Same for the
  // generate flow's deeper steps where the wizard owns keyboard
  // focus.
  const onAdmin = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (onAdmin) return;
    // Mobile uses the BottomBar pill — type-anywhere only fires on
    // pointer-and-keyboard devices wide enough to have a header.
    const mql = window.matchMedia('(max-width: 768px)');
    if (mql.matches) return;

    const submit = (q: string) => {
      // Always land on /#app with ?q=<query>. _index.tsx reads the
      // param on mount and applies it via handleCreateCatalog, then
      // strips the param off the URL so it doesn't linger. From any
      // other route this also handles the navigation back home.
      const target = `/?q=${encodeURIComponent(q)}#app`;
      navigate(target);
    };

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
        submit(q);
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
  }, [navigate, text, active, onAdmin]);

  // Reset transient state on route change so a stale buffer doesn't
  // hang around when the user navigates between pages.
  useEffect(() => {
    setText('');
    setActive(false);
  }, [location.pathname]);

  const visible = !onAdmin && active && text.length > 0;
  const hintVisible = !onAdmin && !visible && !scrolled;

  return (
    <>
      {/* Centered "type anywhere to search" hint. Solid-ish glass
          pill backdrop until the user moves the mouse; then it
          melts to faint text only. Fades fully on scroll. */}
      <div
        className={`type-anywhere-toast ${hintVisible ? 'is-visible' : ''} ${!mouseMoved ? 'is-solid' : ''}`}
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

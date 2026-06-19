import { useEffect, useState } from 'react';
import CatalogLogo from '~/components/CatalogLogo';
import '~/styles/handoff-loader.css';

interface CatalogHandoffLoaderProps {
  /** When false, the loader begins its fade-out and unmounts itself. */
  active: boolean;
  /** Optional caption under the wordmark (e.g. "Opening your catalog…"). */
  label?: string;
  /** Fired once the fade-out has finished and the overlay has unmounted. */
  onDone?: () => void;
}

// Match the CSS fade-out duration (.handoff-loader transition: opacity).
const FADE_MS = 360;

/**
 * Full-screen branded loading overlay used to cover a screen-to-screen
 * handoff (e.g. /generate → My Catalog) so the destination never flashes
 * its empty/skeleton state under the in-flight feed. Opaque #0a0a0a base
 * to match the app, a slow counter-rotating ring sweep behind the CATALOG
 * wordmark — the same visual language as the cold-open splash, kept light.
 *
 * Self-contained: drop it in a destination component, drive `active` from
 * the destination's "ready" signal. When `active` flips false it fades out
 * over FADE_MS then calls onDone and removes itself from the DOM.
 */
export default function CatalogHandoffLoader({ active, label, onDone }: CatalogHandoffLoaderProps) {
  const [mounted, setMounted] = useState(active);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    // Begin fade-out, then unmount once the transition completes.
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      onDone?.();
    }, FADE_MS);
    return () => window.clearTimeout(t);
  }, [active, mounted, onDone]);

  if (!mounted) return null;

  return (
    <div
      className={`handoff-loader${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={label || 'Loading'}
    >
      <div className="handoff-loader-sweep" aria-hidden="true" />
      <div className="handoff-loader-content">
        <CatalogLogo className="handoff-loader-logo" />
        <div className="handoff-loader-dots" aria-hidden="true">
          <i /><i /><i />
        </div>
        {label && <span className="handoff-loader-label">{label}</span>}
      </div>
    </div>
  );
}

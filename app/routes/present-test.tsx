import { useEffect, useState } from 'react';
import {
  PRESENT_SLUG_STORAGE_KEY,
  readPresentSlug,
  writePresentSlug,
} from '~/services/present';

/*
 * Temporary dev harness for the /present/ live-mirror feature.
 *
 * Phase 3 wires the broadcaster into the consumer app via
 * localStorage('present:slug'). This page is the throwaway UI for
 * setting/clearing that flag and grabbing the share link. Phase 10
 * replaces it with a real toggle inside Robert's user menu.
 *
 * Usage:
 *   1. Visit /present-test, type a slug, click Start.
 *   2. Navigate the consumer app normally (/, /l/<slug>, /b/<slug>).
 *   3. Open the shareable link (or /present/<slug>) in another tab
 *      / device / incognito to watch the live feed.
 */
export default function PresentTest() {
  const [slug, setSlug] = useState('robert-burton');
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync activeSlug with localStorage on mount + whenever the flag
  // changes (storage event from another tab, custom event from this
  // tab via writePresentSlug).
  useEffect(() => {
    const refresh = () => setActiveSlug(readPresentSlug());
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === PRESENT_SLUG_STORAGE_KEY) refresh();
    };
    const onCustom = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('present:slug-changed', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('present:slug-changed', onCustom);
    };
  }, []);

  const isBroadcasting = activeSlug !== null;
  const shareUrl = activeSlug && typeof window !== 'undefined'
    ? `${window.location.origin}/present/${activeSlug}`
    : null;

  const handleStart = () => {
    const next = slug.trim();
    if (!next) return;
    writePresentSlug(next);
  };

  const handleStop = () => writePresentSlug(null);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* user denied clipboard, no-op */
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#070707',
      color: '#fff',
      fontFamily: 'Inter, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 460,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 28,
      }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.22em',
          color: 'rgba(255,255,255,0.5)',
          marginBottom: 8,
        }}>
          PRESENT · DEV HARNESS
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, marginBottom: 18 }}>
          Broadcast tester
        </h1>

        <label style={labelStyle}>Slug</label>
        <input
          value={slug}
          onChange={e => setSlug(e.target.value)}
          style={inputStyle}
          spellCheck={false}
          disabled={isBroadcasting}
        />

        <label style={{ ...labelStyle, marginTop: 16 }}>Status</label>
        <div style={{
          fontSize: 13,
          color: isBroadcasting ? '#4ade80' : 'rgba(255,255,255,0.6)',
          fontFamily: 'ui-monospace, monospace',
        }}>
          {isBroadcasting
            ? `broadcasting as "${activeSlug}"`
            : 'idle — broadcaster not mounted'}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          {!isBroadcasting ? (
            <button onClick={handleStart} style={{ ...btnStyle, ...btnPrimaryStyle }}>
              Start broadcasting
            </button>
          ) : (
            <button onClick={handleStop} style={{ ...btnStyle, ...btnDangerStyle }}>
              Stop broadcasting
            </button>
          )}
        </div>

        {shareUrl && (
          <div style={{ marginTop: 22 }}>
            <label style={labelStyle}>Share link</label>
            <div style={{
              display: 'flex',
              gap: 8,
              alignItems: 'stretch',
            }}>
              <code style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                color: '#a78bfa',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {shareUrl}
              </code>
              <button
                onClick={handleCopy}
                style={{
                  ...btnStyle,
                  flex: '0 0 auto',
                  padding: '0 14px',
                  ...btnSecondaryStyle,
                  minWidth: 80,
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <div style={{
          marginTop: 22,
          padding: 12,
          borderRadius: 8,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.55)',
          lineHeight: 1.6,
        }}>
          The slug stays set across reloads. As you navigate the
          consumer app (/, /l/&lt;slug&gt;, /b/&lt;slug&gt;), the
          PresentProvider broadcasts route events to{' '}
          <code style={{ color: '#a78bfa' }}>present:{activeSlug || slug || '<slug>'}</code>.
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.42)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.03)',
  color: '#fff',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 8,
  border: 'none',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnPrimaryStyle: React.CSSProperties = {
  background: '#4ade80',
  color: '#022c11',
};

const btnDangerStyle: React.CSSProperties = {
  background: 'rgba(239,68,68,0.15)',
  color: '#fca5a5',
  border: '1px solid rgba(239,68,68,0.32)',
};

const btnSecondaryStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
};

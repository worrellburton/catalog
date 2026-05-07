import { useEffect, useState } from 'react';
import {
  PRESENT_SLUG_STORAGE_KEY,
  readPresentName,
  readPresentSlug,
  writePresentName,
  writePresentSlug,
} from '~/services/present';

interface PresentMenuSectionProps {
  /** Display name (e.g. user.displayName) — used to seed the slug. */
  defaultName?: string | null;
  /** Hides the section entirely when false. Use for non-presenters. */
  visible?: boolean;
}

/**
 * "Live demo" section for the user menu. Lets Robert flip broadcast
 * on/off and copy a share link to his /present/<slug> mirror in two
 * clicks. State lives in localStorage (services/present) so it
 * survives reloads and is shared with PresentProvider.
 */
export default function PresentMenuSection({ defaultName, visible = true }: PresentMenuSectionProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(() => readPresentSlug());
  const [name, setName] = useState<string>(() => readPresentName() ?? defaultName ?? 'Robert');
  const [editingName, setEditingName] = useState(false);
  const [copied, setCopied] = useState(false);

  // Stay in sync with cross-tab + same-tab slug writes.
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

  if (!visible) return null;

  const broadcasting = activeSlug !== null;
  const slug = broadcasting ? activeSlug! : slugify(name) || 'live';
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/present/${slug}`
    : `/present/${slug}`;

  const handleToggle = () => {
    if (broadcasting) {
      writePresentSlug(null);
    } else {
      writePresentSlug(slug);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard denied — share link stays visible */
    }
  };

  const handleNameSave = (next: string) => {
    const trimmed = next.trim();
    if (trimmed) {
      setName(trimmed);
      writePresentName(trimmed);
    }
    setEditingName(false);
  };

  return (
    <div className="user-menu-section" style={sectionStyle}>
      <div style={headRowStyle}>
        <span style={titleStyle}>Live demo</span>
        <button
          type="button"
          onClick={handleToggle}
          style={{
            ...toggleStyle,
            ...(broadcasting ? toggleOnStyle : toggleOffStyle),
          }}
        >
          <span
            style={{
              ...toggleDotStyle,
              background: broadcasting ? '#ef4444' : 'rgba(255,255,255,0.5)',
              boxShadow: broadcasting ? '0 0 8px #ef4444' : 'none',
              animation: broadcasting ? 'present-pulse 1.4s ease-in-out infinite' : 'none',
            }}
          />
          {broadcasting ? 'On' : 'Off'}
        </button>
      </div>

      <div style={subStyle}>
        Mirror your session to{' '}
        <code style={codeStyle}>/present/{slug}</code>
      </div>

      {/* Display name (used as the cursor label on the viewer). */}
      {!editingName ? (
        <button
          type="button"
          style={inlineRowStyle}
          onClick={() => setEditingName(true)}
        >
          <span style={inlineLabelStyle}>Cursor name</span>
          <span style={inlineValueStyle}>{name}</span>
          <span style={inlineHintStyle}>Edit</span>
        </button>
      ) : (
        <NameEditor
          initial={name}
          onCancel={() => setEditingName(false)}
          onSave={handleNameSave}
        />
      )}

      {broadcasting && (
        <div style={shareRowStyle}>
          <code style={shareUrlStyle} title={shareUrl}>{shareUrl}</code>
          <button
            type="button"
            onClick={handleCopy}
            style={{ ...copyBtnStyle, ...(copied ? copiedStyle : {}) }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
      <style>{KEYFRAMES}</style>
    </div>
  );
}

function NameEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (next: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={editorRowStyle}>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onSave(value);
          else if (e.key === 'Escape') onCancel();
        }}
        style={inputStyle}
      />
      <button type="button" onClick={() => onSave(value)} style={saveBtnStyle}>
        Save
      </button>
    </div>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px',
};

const headRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.62)',
};

const toggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 10px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.14)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  cursor: 'pointer',
};

const toggleOnStyle: React.CSSProperties = {
  background: 'rgba(239,68,68,0.16)',
  borderColor: 'rgba(239,68,68,0.45)',
  color: '#fecaca',
};

const toggleOffStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.6)',
};

const toggleDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
};

const subStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,255,255,0.45)',
  lineHeight: 1.5,
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: '#a78bfa',
};

const inlineRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
};

const inlineLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,255,255,0.5)',
  fontWeight: 600,
};

const inlineValueStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12,
  color: '#fff',
  fontWeight: 500,
};

const inlineHintStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
};

const editorRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  fontSize: 12,
  outline: 'none',
};

const saveBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#fff',
  color: '#0a0a0a',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const shareRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'stretch',
  marginTop: 2,
};

const shareUrlStyle: React.CSSProperties = {
  flex: 1,
  padding: '7px 10px',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  color: '#a78bfa',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const copyBtnStyle: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  flex: '0 0 auto',
};

const copiedStyle: React.CSSProperties = {
  background: 'rgba(74,222,128,0.16)',
  borderColor: 'rgba(74,222,128,0.32)',
  color: '#86efac',
};

const KEYFRAMES = `
@keyframes present-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.85); }
}
`;

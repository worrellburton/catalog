import type { ReactNode } from 'react';

// A toggle row at the top of the Model page. The checkbox turns the
// series' line on/off in the shared graph; clicking the title drops down
// that model's assumptions. Two of these stack: Revenue and Acquisition.

export default function ModelRow({
  title,
  subtitle,
  color,
  checked,
  onCheckedChange,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  color: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`model-row${open ? ' is-open' : ''}${checked ? ' is-on' : ''}`}>
      <div className="model-row-head">
        <label className="model-row-check" title={checked ? 'Hide line' : 'Show line'}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheckedChange(e.target.checked)}
          />
          <span className="model-row-dot" style={{ ['--dot' as string]: color }} />
        </label>
        <button
          type="button"
          className="model-row-title-btn"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className="model-row-title">{title}</span>
          <span className="model-row-sub">{subtitle}</span>
          <svg
            className="model-row-chevron"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {open && <div className="model-row-body">{children}</div>}
    </div>
  );
}

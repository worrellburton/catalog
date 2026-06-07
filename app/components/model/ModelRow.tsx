import type { ReactNode } from 'react';

// A toggle row at the top of the Model page. The checkbox turns the
// series' line on/off in the shared graph; clicking the title drops down
// that model's assumptions; the grip handle drags to reorder. Three of
// these stack: Acquisition, Engagement and Revenue.

export default function ModelRow({
  title,
  subtitle,
  color,
  checked,
  onCheckedChange,
  open,
  onToggle,
  onReset,
  children,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  isDragging,
  isDragOver,
}: {
  title: string;
  subtitle: string;
  color: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  open: boolean;
  onToggle: () => void;
  onReset?: () => void;
  children: ReactNode;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}) {
  return (
    <div
      className={`model-row${open ? ' is-open' : ''}${checked ? ' is-on' : ''}${isDragging ? ' is-dragging' : ''}${isDragOver ? ' is-drag-over' : ''}`}
      onDragOver={(e) => { if (onDrop) e.preventDefault(); }}
      onDragEnter={onDragEnter}
      onDrop={(e) => { if (onDrop) { e.preventDefault(); onDrop(); } }}
    >
      <div className="model-row-head">
        <span
          className="model-row-grip"
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          aria-label="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
          </svg>
        </span>
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
        </button>
        {onReset && (
          <button
            type="button"
            className="model-row-reset"
            onClick={onReset}
            title={`Reset ${title}`}
            aria-label={`Reset ${title}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="model-row-chevron-btn"
          onClick={onToggle}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
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

import type { ReactNode } from 'react';

// A reorderable card with a grip handle + title (and optional header
// action). Used to drag the OpEx page sections around.
export default function DragCard({
  title,
  action,
  children,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  isDragging,
  isDragOver,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}) {
  return (
    <section
      className={`model-card opex-section${isDragging ? ' is-dragging' : ''}${isDragOver ? ' is-drag-over' : ''}`}
      onDragOver={(e) => { if (onDrop) e.preventDefault(); }}
      onDragEnter={onDragEnter}
      onDrop={(e) => { if (onDrop) { e.preventDefault(); onDrop(); } }}
    >
      <div className="opex-section-head">
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
        <h3>{title}</h3>
        {action && <div className="opex-section-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

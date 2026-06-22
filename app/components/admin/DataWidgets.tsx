// Small self-contained presentational widgets for the admin Data surface.
// Extracted from app/routes/admin/data.tsx (god-file split #8) — both are
// pure prop-driven components (no coupling to the page's state), so they live
// on their own and keep the route file focused on orchestration.

import { useId, useState } from 'react';

/** Drag-and-drop (or click-to-pick) photo upload tile for the product detail
 *  Photos panel. Square to match the photo thumbnails; highlights green on
 *  dragover; shows a spinner while the parent uploads. */
export function PhotoDropzone({ busy, onFiles }: { busy: boolean; onFiles: (files: File[]) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const inputId = useId();
  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onFiles(files);
      }}
      title="Drag images here or click to upload"
      style={{
        aspectRatio: '1 / 1',
        border: `2px dashed ${dragOver ? '#059669' : '#cbd5e1'}`,
        borderRadius: 6,
        background: dragOver ? '#ecfdf5' : '#f8fafc',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, cursor: busy ? 'wait' : 'pointer',
        color: dragOver ? '#059669' : '#94a3b8', textAlign: 'center', padding: 4,
        transition: 'all 0.12s',
      }}
    >
      {busy ? (
        <>
          <style>{`@keyframes pdz-spin { to { transform: rotate(360deg); } }`}</style>
          <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #cbd5e1', borderTopColor: '#059669', animation: 'pdz-spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 9 }}>Uploading…</span>
        </>
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span style={{ fontSize: 9, fontWeight: 600, lineHeight: 1.2 }}>Drop / upload</span>
        </>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** Pill toggle used across the Data tables (Home/active flags etc.). */
export function AdminToggle({ on, onChange }: { on: boolean; onChange: (val: boolean) => void }) {
  return (
    <button
      className={`admin-toggle-btn ${on ? 'on' : 'off'}`}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      aria-label={on ? 'Toggle off' : 'Toggle on'}
    >
      <span className="admin-toggle-track">
        <span className="admin-toggle-thumb" />
      </span>
    </button>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';

// One-viewport video trimmer. Shows the picked video with a scrub timeline and
// draggable in/out handles. "Done" returns the selected range + a poster image
// captured from the FIRST frame of the selection (per product spec). The clip
// itself is stored as-is with the range (no client-side re-encode); the look
// surfaces play the [start,end] window.

export interface VideoTrimResult {
  start: number;
  end: number;
  /** JPEG data URL of the first frame of the selection. */
  poster: string;
}

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (result: VideoTrimResult) => void;
}

function fmt(t: number): string {
  if (!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoTrimmer({ file, onCancel, onConfirm }: Props) {
  const url = useRef<string>('');
  if (!url.current) url.current = URL.createObjectURL(file);
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const drag = useRef<'start' | 'end' | 'scrub' | null>(null);

  const onLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration || 0;
    setDuration(d);
    setStart(0);
    setEnd(d);
    v.currentTime = 0;
  }, []);

  // Loop playback within the selected window.
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrent(v.currentTime);
    if (v.currentTime >= end) { v.currentTime = start; }
    if (v.currentTime < start) { v.currentTime = start; }
  }, [start, end]);

  const timeFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el || !duration) return 0;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return ratio * duration;
  }, [duration]);

  const onPointerDown = useCallback((mode: 'start' | 'end' | 'scrub') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = mode;
    const t = timeFromClientX(e.clientX);
    const v = videoRef.current;
    if (mode === 'start') { const ns = Math.min(t, end - 0.2); setStart(Math.max(0, ns)); if (v) v.currentTime = Math.max(0, ns); }
    else if (mode === 'end') { const ne = Math.max(t, start + 0.2); setEnd(Math.min(duration, ne)); }
    else { if (v) v.currentTime = Math.min(end, Math.max(start, t)); }
  }, [timeFromClientX, start, end, duration]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const t = timeFromClientX(e.clientX);
    const v = videoRef.current;
    if (drag.current === 'start') { const ns = Math.min(Math.max(0, t), end - 0.2); setStart(ns); if (v) v.currentTime = ns; }
    else if (drag.current === 'end') { const ne = Math.max(Math.min(duration, t), start + 0.2); setEnd(ne); }
    else { if (v) v.currentTime = Math.min(end, Math.max(start, t)); }
  }, [timeFromClientX, start, end, duration]);

  const onPointerUp = useCallback(() => { drag.current = null; }, []);

  // Capture the first frame of the selection as a JPEG poster, then confirm.
  const handleDone = useCallback(async () => {
    const v = videoRef.current;
    if (!v) { onConfirm({ start, end, poster: '' }); return; }
    setBusy(true);
    try {
      await new Promise<void>((resolve) => {
        const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
        v.addEventListener('seeked', onSeeked);
        v.currentTime = start;
        // Safety timeout in case 'seeked' never fires.
        setTimeout(resolve, 600);
      });
      let poster = '';
      try {
        const canvas = document.createElement('canvas');
        canvas.width = v.videoWidth || 720;
        canvas.height = v.videoHeight || 1280;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          poster = canvas.toDataURL('image/jpeg', 0.82);
        }
      } catch { /* tainted/decode failure → no poster */ }
      onConfirm({ start, end, poster });
    } finally {
      setBusy(false);
    }
  }, [start, end, onConfirm]);

  return (
    <div className="vtrim" role="dialog" aria-modal="true" aria-label="Trim video">
      <header className="vtrim-head">
        <button type="button" className="vtrim-cancel" onClick={onCancel}>Cancel</button>
        <span className="vtrim-title">Trim</span>
        <button type="button" className="vtrim-done" onClick={handleDone} disabled={busy || duration === 0}>
          {busy ? 'Saving…' : 'Done'}
        </button>
      </header>

      <div className="vtrim-stage">
        <video
          ref={videoRef}
          src={url.current}
          className="vtrim-video"
          playsInline
          muted
          autoPlay
          loop
          onLoadedMetadata={onLoaded}
          onTimeUpdate={onTimeUpdate}
        />
      </div>

      <div className="vtrim-controls">
        <div className="vtrim-times">
          <span>{fmt(start)}</span>
          <span className="vtrim-times-dur">{fmt(end - start)} selected</span>
          <span>{fmt(end)}</span>
        </div>
        <div
          ref={trackRef}
          className="vtrim-track"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Scrub surface (between the handles). */}
          <div className="vtrim-track-scrub" onPointerDown={onPointerDown('scrub')} />
          {/* Selected window. */}
          <div
            className="vtrim-sel"
            style={{
              left: duration ? `${(start / duration) * 100}%` : '0%',
              right: duration ? `${(1 - end / duration) * 100}%` : '0%',
            }}
          />
          {/* Playhead. */}
          <div
            className="vtrim-playhead"
            style={{ left: duration ? `${(current / duration) * 100}%` : '0%' }}
          />
          {/* In / out handles. */}
          <div
            className="vtrim-handle vtrim-handle--start"
            style={{ left: duration ? `${(start / duration) * 100}%` : '0%' }}
            onPointerDown={onPointerDown('start')}
            role="slider"
            aria-label="Start"
            aria-valuenow={Math.round(start)}
          />
          <div
            className="vtrim-handle vtrim-handle--end"
            style={{ left: duration ? `${(end / duration) * 100}%` : '100%' }}
            onPointerDown={onPointerDown('end')}
            role="slider"
            aria-label="End"
            aria-valuenow={Math.round(end)}
          />
        </div>
        <p className="vtrim-hint">Drag the ends to trim · the first frame becomes your poster</p>
      </div>
    </div>
  );
}

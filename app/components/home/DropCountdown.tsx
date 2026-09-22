// imports
import { useEffect, useState } from 'react';

// types
interface DropCountdownProps {
  /** UTC hour (0..23) the daily feed rolls over — AutoEditorConfig.refreshHour. */
  refreshHour: number;
}

// helpers
function formatCountdown(nowMs: number, refreshHour: number): string {
  const now = new Date(nowMs);
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), refreshHour, 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  let s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  const hh = Math.floor(s / 3600); s -= hh * 3600;
  const mm = Math.floor(s / 60); s -= mm * 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(s)}`;
}

// main logic
/**
 * Live "next feed drops in HH:MM:SS" readout. A leaf component so the
 * one-second tick re-renders only this span — it used to live in the hero,
 * which re-rendered the whole hero subtree (headline, spark, inline search
 * bar) every second for as long as the shopper was on the home page, even
 * scrolled far past it. The tick pauses while the tab is hidden.
 */
export default function DropCountdown({ refreshHour }: DropCountdownProps) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const start = () => {
      window.clearInterval(timer);
      setNowTick(Date.now());
      timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    };
    const onVisibility = () => {
      if (document.hidden) window.clearInterval(timer);
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  const text = formatCountdown(nowTick, refreshHour);
  return (
    <span className="sfh-scroll-sub" aria-label={`Your next feed drops in ${text}`}>
      Your next feed drops in{' '}
      <span className="sfh-scroll-countdown">{text}</span>
    </span>
  );
}

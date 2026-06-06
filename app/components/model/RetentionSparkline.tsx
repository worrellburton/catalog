import { fmtPercent } from '~/services/projections';

// A small cohort-retention curve: of a cohort acquired in month 0, what
// share is still active m months later, at the current churn rate.
export default function RetentionSparkline({ data }: { data: number[] }) {
  const W = 320, H = 90, PAD = 6;
  const n = data.length;
  const x = (i: number) => PAD + ((W - PAD * 2) * i) / Math.max(1, n - 1);
  const y = (v: number) => PAD + (H - PAD * 2) * (1 - v); // data is 0..1
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  const area = `${line} L ${x(n - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;
  const m6 = data[6] ?? 0;
  const m12 = data[12] ?? 0;
  return (
    <div className="retention">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="retention-svg">
        <path d={area} fill="rgba(99,102,241,0.12)" />
        <path d={line} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="retention-marks">
        <span>M6 <strong>{fmtPercent(m6, 0)}</strong></span>
        <span>M12 <strong>{fmtPercent(m12, 0)}</strong></span>
      </div>
    </div>
  );
}


import { useState, useRef, useEffect } from 'react';
import CatalogLogo from './CatalogLogo';

interface PasswordGateProps {
  onSubmit: (password: string) => boolean;
}

const brandNames = [
  'ZARA', 'NIKE', 'ADIDAS', 'GUCCI', 'PRADA',
  'DIOR', 'CHANEL', 'LOUIS VUITTON', 'BALENCIAGA', 'VERSACE',
  'BURBERRY', 'FENDI', 'GIVENCHY', 'VALENTINO', 'SAINT LAURENT',
  'CELINE', 'LOEWE', 'BOTTEGA VENETA', 'DIESEL', 'ACNE STUDIOS',
  'STÜSSY', 'SUPREME', 'CARHARTT', 'PATAGONIA', 'THE NORTH FACE',
  'UNIQLO', 'H&M', 'COS', 'ARKET', 'ASOS',
  'RALPH LAUREN', 'TOMMY HILFIGER', 'CALVIN KLEIN', 'HUGO BOSS', 'LACOSTE',
  'ROLEX', 'OMEGA', 'CARTIER', 'TIFFANY & CO', 'RAY-BAN',
  'NEW BALANCE', 'CONVERSE', 'VANS', 'PUMA', 'ASICS',
  'LULULEMON', 'GYMSHARK', 'THEORY', 'REISS', 'ALLSAINTS',
];

function getRows(rowCount: number): string[][] {
  const shuffled = [...brandNames].sort(() => Math.random() - 0.5);
  const rows: string[][] = [];
  const perRow = Math.ceil(shuffled.length / rowCount);
  for (let i = 0; i < rowCount; i++) {
    const start = (i * perRow) % shuffled.length;
    const row: string[] = [];
    for (let j = 0; j < perRow; j++) {
      row.push(shuffled[(start + j) % shuffled.length]);
    }
    rows.push(row);
  }
  return rows;
}

export default function PasswordGate({ onSubmit }: PasswordGateProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows] = useState(() => getRows(8));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const attemptLogin = () => {
    const val = value.trim().toLowerCase();
    const success = onSubmit(val);
    if (success) {
      setDismissed(true);
    } else {
      setError('Incorrect code');
      setValue('');
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  };

  if (dismissed) return null;

  return (
    <div className="password-gate">
      <div className="pw-marquee-bg" aria-hidden="true">
        {rows.map((row, i) => (
          <div
            key={i}
            className="pw-marquee-row"
            style={{
              animationDuration: `${30 + i * 5}s`,
              animationDirection: i % 2 === 0 ? 'normal' : 'reverse',
            }}
          >
            {/* Duplicate row for seamless loop */}
            {[...row, ...row].map((name, j) => (
              <span key={j} className="pw-brand-name">{name}</span>
            ))}
          </div>
        ))}
      </div>
      <div className="pw-content">
        <CatalogLogo className="pw-logo" />
        <p className="pw-subtitle">Enter access code</p>
        <div className="pw-input-wrap">
          <input
            ref={inputRef}
            type="password"
            className={`pw-input ${shaking ? 'shake' : ''}`}
            placeholder="---"
            maxLength={10}
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') attemptLogin(); }}
          />
        </div>
        <button className="pw-enter" onClick={attemptLogin}>Enter</button>
        <p className="pw-error">{error}</p>
      </div>
    </div>
  );
}

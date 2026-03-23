
import { useState, useRef, useEffect } from 'react';
import CatalogLogo from './CatalogLogo';

interface PasswordGateProps {
  onSubmit: (password: string) => boolean;
}

const brandDomains = [
  'zara.com', 'nike.com', 'adidas.com', 'gucci.com', 'prada.com',
  'dior.com', 'chanel.com', 'louisvuitton.com', 'balenciaga.com', 'versace.com',
  'burberry.com', 'fendi.com', 'givenchy.com', 'valentino.com', 'saintlaurent.com',
  'celine.com', 'loewe.com', 'bottegaveneta.com', 'diesel.com', 'acnestudios.com',
  'stussy.com', 'supremenewyork.com', 'carhartt.com', 'patagonia.com', 'northface.com',
  'uniqlo.com', 'hm.com', 'cos.com', 'arket.com', 'asos.com',
  'suitsupply.com', 'vince.com', 'theory.com', 'reiss.com', 'allsaints.com',
  'rolex.com', 'omega.com', 'cartier.com', 'tiffany.com', 'pandora.com',
  'rayban.com', 'oakley.com', 'warbyparker.com', 'lululemon.com', 'gymshark.com',
  'newbalance.com', 'converse.com', 'vans.com', 'puma.com', 'asics.com',
  'ralphlauren.com', 'tommyhilfiger.com', 'calvinklein.com', 'hugoboss.com', 'lacoste.com',
];

function getBrandLogo(domain: string) {
  return `https://cdn.brandfetch.io/${domain}/theme/dark/logo?c=1id3n10pdBTarCHI0db`;
}

function getRows(rowCount: number): string[][] {
  const shuffled = [...brandDomains].sort(() => Math.random() - 0.5);
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
  const [rows] = useState(() => getRows(12));

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
              animationDuration: `${25 + i * 4}s`,
              animationDirection: i % 2 === 0 ? 'normal' : 'reverse',
            }}
          >
            {[...row, ...row].map((domain, j) => (
              <img
                key={j}
                className="pw-marquee-logo"
                src={getBrandLogo(domain)}
                alt=""
                loading="lazy"
              />
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


import { useState, useRef, useEffect, useMemo } from 'react';
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
  'fujifilm.com', 'leica-camera.com', 'apple.com', 'sony.com', 'bose.com',
  'rolex.com', 'omega.com', 'cartier.com', 'tiffany.com', 'pandora.com',
  'rayban.com', 'oakley.com', 'warbyparker.com', 'lululemon.com', 'gymshark.com',
  'newbalance.com', 'converse.com', 'vans.com', 'puma.com', 'asics.com',
  'ralphlauren.com', 'tommyhilfiger.com', 'calvinklein.com', 'hugoboss.com', 'lacoste.com',
];

function getBrandLogo(domain: string) {
  return `https://cdn.brandfetch.io/${domain}/theme/dark/logo?c=1id3n10pdBTarCHI0db`;
}

interface FloatingLogo {
  domain: string;
  x: number;
  y: number;
  size: number;
  speed: number;
  drift: number;
  opacity: number;
  delay: number;
}

function generateLogos(count: number): FloatingLogo[] {
  const logos: FloatingLogo[] = [];
  const shuffled = [...brandDomains].sort(() => Math.random() - 0.5);
  for (let i = 0; i < count; i++) {
    logos.push({
      domain: shuffled[i % shuffled.length],
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 40 + Math.random() * 40,
      speed: 18 + Math.random() * 30,
      drift: -30 + Math.random() * 60,
      opacity: 0.04 + Math.random() * 0.08,
      delay: Math.random() * -40,
    });
  }
  return logos;
}

export default function PasswordGate({ onSubmit }: PasswordGateProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logos = useMemo(() => generateLogos(50), []);

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
      <div className="pw-logos-bg" aria-hidden="true">
        {logos.map((logo, i) => (
          <div
            key={i}
            className="pw-floating-logo"
            style={{
              left: `${logo.x}%`,
              width: logo.size * 1.8,
              height: logo.size,
              opacity: logo.opacity,
              animationDuration: `${logo.speed}s`,
              animationDelay: `${logo.delay}s`,
              '--drift': `${logo.drift}px`,
            } as React.CSSProperties}
          >
            <img
              src={getBrandLogo(logo.domain)}
              alt=""
              width={logo.size}
              height={logo.size}
              loading="lazy"
            />
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

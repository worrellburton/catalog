
import { useState, useRef, useEffect } from 'react';
import CatalogLogo from './CatalogLogo';
import { signInWithGoogle, sendPhoneOtp, verifyPhoneOtp } from '~/services/auth';

interface PasswordGateProps {
  onSubmit: (password: string) => boolean;
  onAuthSuccess?: () => void;
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

const catalogNames = [
  'The Drip Report', 'Fit Check Files', 'Main Character Energy', 'The Vibe Vault',
  'Rich Auntie Energy', 'The Black Card Edit', 'Slay Catalog', 'The It-Girl Index',
  'Hype Beast Herald', 'Drop Day Dispatch', 'Corporate Slay', 'Quiet Quitting Couture',
  'Bark Avenue Boutique', 'Ooh La La List', 'Harajuku Heat Check', 'Mimosa Mode',
  'Hot & Unbothered', 'Glitter & Regret', 'The Dapper Dude Edit', 'Couch Potato Chic',
];

type AuthMode = 'main' | 'phone' | 'otp' | 'code';

function getBrandLogo(domain: string) {
  return `https://cdn.brandfetch.io/${domain}/theme/dark/logo?c=1id3n10pdBTarCHI0db`;
}

function getRows(rowCount: number): string[][] {
  const shuffled = [...brandDomains];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
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

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export default function PasswordGate({ onSubmit, onAuthSuccess }: PasswordGateProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('main');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [nameIndex, setNameIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordSectionRef = useRef<HTMLDivElement>(null);
  const [rows] = useState(() => getRows(12));

  useEffect(() => {
    const interval = setInterval(() => {
      setNameIndex((prev) => (prev + 1) % catalogNames.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [authMode]);

  const scrollToAuth = () => {
    passwordSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => inputRef.current?.focus(), 600);
  };

  const shake = () => {
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    const result = await signInWithGoogle();
    if (result.error) {
      setError(result.error);
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setError('Enter a valid phone number');
      shake();
      return;
    }
    setError('');
    setLoading(true);
    const fullPhone = digits.length === 10 ? `+1${digits}` : `+${digits}`;
    const result = await sendPhoneOtp(fullPhone);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      shake();
    } else {
      setAuthMode('otp');
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length < 6) {
      setError('Enter the 6-digit code');
      shake();
      return;
    }
    setError('');
    setLoading(true);
    const digits = phone.replace(/\D/g, '');
    const fullPhone = digits.length === 10 ? `+1${digits}` : `+${digits}`;
    const result = await verifyPhoneOtp(fullPhone, otpCode);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      shake();
    } else {
      setDismissed(true);
      onAuthSuccess?.();
    }
  };

  const handleAccessCode = () => {
    const val = accessCode.trim().toLowerCase();
    const success = onSubmit(val);
    if (success) {
      setDismissed(true);
    } else {
      setError('Incorrect code');
      setAccessCode('');
      shake();
    }
  };

  if (dismissed) return null;

  return (
    <div className="password-gate">
      {/* Hero section */}
      <div className="pw-hero">
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
        <div className="pw-hero-vignette" />
        <div className="pw-hero-content">
          <CatalogLogo className="pw-hero-logo" />
          <div className="pw-rotating-name-wrap">
            <span key={nameIndex} className="pw-rotating-name">
              {catalogNames[nameIndex]}
            </span>
          </div>
        </div>
        <button className="pw-scroll-hint" onClick={scrollToAuth} aria-label="Scroll down">
          <span className="pw-scroll-arrow">&#8595;</span>
        </button>
      </div>

      {/* Auth section */}
      <div className="pw-password-section" ref={passwordSectionRef}>
        <div className="pw-content">

          {/* Main auth view */}
          {authMode === 'main' && (
            <>
              <p className="pw-subtitle">Sign in to continue</p>

              <button className="pw-google-btn" onClick={handleGoogleSignIn} disabled={loading}>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span>{loading ? 'Signing in...' : 'Continue with Google'}</span>
              </button>

              <button className="pw-phone-btn" onClick={() => { setAuthMode('phone'); setError(''); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                </svg>
                <span>Continue with Phone</span>
              </button>

              <div className="pw-divider">
                <span>or</span>
              </div>

              <button className="pw-code-btn" onClick={() => { setAuthMode('code'); setError(''); }}>
                Enter access code
              </button>
            </>
          )}

          {/* Phone number entry */}
          {authMode === 'phone' && (
            <>
              <p className="pw-subtitle">Enter your phone number</p>
              <p className="pw-hint">We'll send you a verification code</p>
              <div className="pw-input-wrap">
                <span className="pw-phone-prefix">+1</span>
                <input
                  ref={inputRef}
                  type="tel"
                  className={`pw-input pw-input-phone ${shaking ? 'shake' : ''}`}
                  placeholder="(555) 123-4567"
                  value={formatPhone(phone)}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp(); }}
                />
              </div>
              <button className="pw-enter" onClick={handleSendOtp} disabled={loading}>
                {loading ? 'Sending...' : 'Send Code'}
              </button>
              <p className="pw-error">{error}</p>
              <button className="pw-back-link" onClick={() => { setAuthMode('main'); setError(''); }}>
                &larr; Back
              </button>
            </>
          )}

          {/* OTP verification */}
          {authMode === 'otp' && (
            <>
              <p className="pw-subtitle">Enter verification code</p>
              <p className="pw-hint">Sent to +1 {formatPhone(phone)}</p>
              <div className="pw-input-wrap">
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  className={`pw-input pw-input-otp ${shaking ? 'shake' : ''}`}
                  placeholder="000000"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp(); }}
                />
              </div>
              <button className="pw-enter" onClick={handleVerifyOtp} disabled={loading}>
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <p className="pw-error">{error}</p>
              <button className="pw-back-link" onClick={() => { setAuthMode('phone'); setError(''); setOtpCode(''); }}>
                &larr; Change number
              </button>
            </>
          )}

          {/* Access code (legacy) */}
          {authMode === 'code' && (
            <>
              <p className="pw-subtitle">Enter access code</p>
              <div className="pw-input-wrap">
                <input
                  ref={inputRef}
                  type="password"
                  className={`pw-input ${shaking ? 'shake' : ''}`}
                  placeholder="---"
                  maxLength={10}
                  autoComplete="off"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAccessCode(); }}
                />
              </div>
              <button className="pw-enter" onClick={handleAccessCode}>Enter</button>
              <p className="pw-error">{error}</p>
              <button className="pw-back-link" onClick={() => { setAuthMode('main'); setError(''); }}>
                &larr; Back
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

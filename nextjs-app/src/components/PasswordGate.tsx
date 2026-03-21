'use client';

import { useState, useRef, useEffect } from 'react';
import CatalogLogo from './CatalogLogo';

interface PasswordGateProps {
  onSubmit: (password: string) => boolean;
}

export default function PasswordGate({ onSubmit }: PasswordGateProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

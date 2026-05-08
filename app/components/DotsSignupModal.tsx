import { useState } from 'react';
import {
  createDotsUser,
  checkDotsExistence,
  verifyDotsUser,
  resendDotsVerification,
  attachExistingDotsUser,
} from '~/services/earnings';

type Step = 'form' | 'otp' | 'connected';

interface Props {
  userEmail?: string;
  onConnected: () => void;
  onClose: () => void;
}

export default function DotsSignupModal({ userEmail, onConnected, onClose }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(userEmail ?? '');
  const [countryCode, setCountryCode] = useState('1');
  const [phone, setPhone] = useState('');

  // OTP
  const [otp, setOtp] = useState('');
  const [dotsUserId, setDotsUserId] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  function startResendCooldown() {
    setResendCooldown(30);
    const iv = setInterval(() => {
      setResendCooldown(c => {
        if (c <= 1) { clearInterval(iv); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  async function handleSubmitForm() {
    if (!firstName || !lastName || !phone || !email) {
      setError('All fields are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Check if phone already exists in Dots
      const existence = await checkDotsExistence(countryCode, phone);
      if (existence.exists && existence.dots_user_id) {
        // Attach existing account
        await attachExistingDotsUser(countryCode, phone);
        setDotsUserId(existence.dots_user_id);
      } else {
        // Create new
        const res = await createDotsUser({
          first_name: firstName,
          last_name: lastName,
          email,
          country_code: countryCode,
          phone_number: phone,
        });
        setDotsUserId(res.dots_user_id);
      }
      startResendCooldown();
      setStep('otp');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to register. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otp || otp.length < 4) {
      setError('Enter the verification code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await verifyDotsUser(otp, dotsUserId || undefined);
      setStep('connected');
      onConnected();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      await resendDotsVerification();
      startResendCooldown();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440,
        padding: 32, boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
              {step === 'connected' ? 'Account Connected!' : 'Connect Payout Account'}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>
              {step === 'form' && 'Enter your details to set up payouts via Dots'}
              {step === 'otp' && 'Enter the code sent to your phone'}
              {step === 'connected' && 'Your payout account is ready'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        {step !== 'connected' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
            {(['form', 'otp'] as Step[]).map((s, i) => (
              <div key={s} style={{
                height: 4, flex: 1, borderRadius: 2,
                background: step === 'form' && i === 0 ? '#000' :
                             step === 'otp' && i <= 1 ? '#000' : '#e0e0e0',
              }} />
            ))}
          </div>
        )}

        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8,
            padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626',
          }}>
            {error}
          </div>
        )}

        {/* Step: Form */}
        {step === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>First Name</label>
                <input
                  style={inputStyle}
                  placeholder="Jane"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Last Name</label>
                <input
                  style={inputStyle}
                  placeholder="Doe"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                style={inputStyle}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Phone Number</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#666' }}>+</span>
                  <input
                    style={{ ...inputStyle, paddingLeft: 22, width: 64 }}
                    placeholder="1"
                    value={countryCode}
                    onChange={e => setCountryCode(e.target.value.replace(/\D/g, ''))}
                    maxLength={3}
                  />
                </div>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  type="tel"
                  placeholder="555 000 0000"
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
            <button
              style={primaryBtnStyle}
              onClick={handleSubmitForm}
              disabled={loading}
            >
              {loading ? 'Registering…' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step: OTP */}
        {step === 'otp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 4 }}>📱</div>
            <p style={{ margin: 0, fontSize: 14, color: '#444' }}>
              We sent a code to <strong>+{countryCode} {phone}</strong>
            </p>
            <input
              style={{ ...inputStyle, textAlign: 'center', fontSize: 24, letterSpacing: 8, fontWeight: 700 }}
              placeholder="• • • • • •"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              maxLength={6}
              autoFocus
            />
            <button
              style={primaryBtnStyle}
              onClick={handleVerifyOtp}
              disabled={loading}
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              style={{ background: 'none', border: 'none', cursor: resendCooldown > 0 ? 'default' : 'pointer', color: resendCooldown > 0 ? '#999' : '#1976d2', fontSize: 13 }}
              onClick={handleResend}
              disabled={resendCooldown > 0}
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </div>
        )}

        {/* Step: Connected */}
        {step === 'connected' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <p style={{ fontSize: 14, color: '#444', marginBottom: 24 }}>
              Your Dots payout account is connected. You can now withdraw your earnings directly to your bank, Venmo, or PayPal.
            </p>
            <button style={primaryBtnStyle} onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 500,
  color: '#374151', marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtnStyle: React.CSSProperties = {
  width: '100%', padding: '12px 0', background: '#000', color: '#fff',
  border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600,
  cursor: 'pointer',
};

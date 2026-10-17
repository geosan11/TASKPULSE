import React, { useEffect, useState } from 'react';
import { Briefcase, Loader2, User } from 'lucide-react';
import { Modal, inputClass, primaryButtonClass, Label, ErrorText, Mascot } from './ui';
import { HEARD_ABOUT_US_OPTIONS } from '../config/marketplace';
import {
  checkDuplicateUser,
  resendVerificationEmail,
  signInUser,
  signUpUser,
  supabase,
} from '../lib/supabaseClient';
import { celebrate } from '../lib/celebrate';

export type AuthMode = 'signin' | 'signup' | 'verify_email';
export type AccountType = 'worker' | 'business';

const PHONE_RE = /^0[789][01]\d{8}$/;

export function AuthModal({
  open,
  initialMode,
  initialAccountType,
  referralCode,
  onClose,
  onSignedIn,
  onOpenTerms,
  notify,
}: {
  open: boolean;
  initialMode: AuthMode;
  initialAccountType: AccountType;
  referralCode: string;
  onClose: () => void;
  onSignedIn: () => void;
  onOpenTerms: (tab: 'terms' | 'privacy') => void;
  notify: (title: string, subtitle: string) => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [accountType, setAccountType] = useState<AccountType>(initialAccountType);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [heardAboutUs, setHeardAboutUs] = useState('');
  const [refCode, setRefCode] = useState(referralCode);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setAccountType(initialAccountType);
      setError(null);
    }
  }, [open, initialMode, initialAccountType]);

  useEffect(() => setRefCode(referralCode), [referralCode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const handleBlurDuplicate = async (field: 'email' | 'username' | 'phone') => {
    if (mode !== 'signup') return;
    const value = field === 'email' ? email : field === 'username' ? username : phone;
    if (!value.trim()) return;
    const res = await checkDuplicateUser(
      field === 'email' ? email : '',
      field === 'username' ? username : '',
      field === 'phone' ? phone : ''
    );
    if (res.exists) setError(res.message || 'This detail is already registered.');
    else setError(null);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanPhone = phone.replace(/\D/g, '');
    if (!email || !password || !username || !fullName || !phone) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
      setError('Username must be 3-30 letters, numbers or underscores.');
      return;
    }
    if (!PHONE_RE.test(cleanPhone)) {
      setError('Enter a valid 11-digit Nigerian mobile number (e.g. 08012345678).');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (accountType === 'business' && businessName.trim().length < 2) {
      setError('Please enter your business name.');
      return;
    }
    if (!acceptTerms) {
      setError('Please agree to the Terms of Service & Privacy Policy.');
      return;
    }

    setSubmitting(true);
    const res = await signUpUser({
      email,
      password,
      username,
      fullName,
      phone: cleanPhone,
      referralCode: refCode || undefined,
      heardAboutUs: heardAboutUs || undefined,
      accountType,
      businessName: accountType === 'business' ? businessName : undefined,
    });
    setSubmitting(false);

    if (!res.success) {
      setError(res.error || 'Could not create your account.');
      return;
    }
    if (!res.session && supabase) {
      setMode('verify_email');
      setResendCooldown(60);
      notify('Check your inbox ✉️', `We sent a confirmation link to ${email.trim()}`);
      return;
    }
    celebrate(`Welcome, ${fullName.trim().split(' ')[0] || username.trim()}!`, accountType === 'business' ? 'Post your first task to get started.' : 'Pick a task and start earning.');
    onSignedIn();
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setSubmitting(true);
    const res = await signInUser(email, password);
    setSubmitting(false);
    if (!res.success) {
      const msg = (res.error || '').toLowerCase();
      if (msg.includes('not confirmed')) {
        setMode('verify_email');
        setResendCooldown(60);
        return;
      }
      setError(res.error || 'Invalid email or password.');
      return;
    }
    notify('Welcome back!', 'You are signed in.');
    onSignedIn();
  };

  const handleResend = async () => {
    if (!email || resendCooldown > 0) return;
    const res = await resendVerificationEmail(email);
    if (res.success) {
      setResendCooldown(60);
      notify('Verification sent ✉️', `Check ${email.trim()}`);
    } else {
      setError(res.error || 'Could not resend the email.');
    }
  };

  if (mode === 'verify_email') {
    return (
      <Modal open={open} onClose={onClose} title="Confirm your email" eyebrow="Almost there">
        <div className="text-center space-y-3">
          <Mascot pose="happy" className="w-24 h-24 mx-auto" />
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            We sent a confirmation link to <strong>{email || 'your email'}</strong>. Open it, then come back and sign in.
          </p>
          {error && <ErrorText>{error}</ErrorText>}
          <button type="button" className={primaryButtonClass} onClick={() => setMode('signin')}>
            I've confirmed, sign in
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || !email}
            className="text-sm font-bold text-pulse-700 dark:text-pulse-400 disabled:opacity-50 cursor-pointer"
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend confirmation email'}
          </button>
        </div>
      </Modal>
    );
  }

  const isSignup = mode === 'signup';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isSignup ? (accountType === 'business' ? 'Create a business account' : 'Join TaskPulse free') : 'Sign in'}
      eyebrow={isSignup ? 'No deposit, ever' : 'Welcome back'}
    >
      <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-zinc-100 dark:bg-zinc-900">
        {(['signin', 'signup'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`h-10 rounded-full text-sm font-bold cursor-pointer transition-all ${
              mode === m ? 'bg-white dark:bg-zinc-800 text-ink dark:text-white shadow-sm' : 'text-zinc-500'
            }`}
          >
            {m === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        ))}
      </div>

      <form onSubmit={isSignup ? handleSignUp : handleSignIn} className="space-y-4">
        {isSignup && (
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'worker', label: 'I want to earn', icon: <User className="w-4 h-4" /> },
              { id: 'business', label: 'I want to post tasks', icon: <Briefcase className="w-4 h-4" /> },
            ] as const).map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAccountType(opt.id)}
                className={`p-4 rounded-2xl border-2 text-left cursor-pointer transition-all ${
                  accountType === opt.id
                    ? 'border-pulse-500 bg-pulse-500/10 text-ink dark:text-white'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {opt.icon}
                <span className="block text-sm font-extrabold mt-1">{opt.label}</span>
              </button>
            ))}
          </div>
        )}

        {isSignup && (
          <>
            <div>
              <Label>Full name</Label>
              <input className={inputClass} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Chiamaka Obi" autoComplete="name" />
            </div>
            <div>
              <Label>Username</Label>
              <input className={inputClass} value={username} onChange={e => setUsername(e.target.value)} onBlur={() => handleBlurDuplicate('username')} placeholder="chiamaka" autoComplete="username" />
            </div>
            <div>
              <Label>Phone number</Label>
              <input className={inputClass} value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => handleBlurDuplicate('phone')} placeholder="08012345678" inputMode="tel" autoComplete="tel" />
            </div>
            {accountType === 'business' && (
              <div>
                <Label>Business name</Label>
                <input className={inputClass} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Acme Foods Ltd" autoComplete="organization" />
              </div>
            )}
          </>
        )}

        <div>
          <Label>Email</Label>
          <input className={inputClass} type="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={() => handleBlurDuplicate('email')} placeholder="you@example.com" autoComplete="email" />
        </div>
        <div>
          <Label>Password</Label>
          <input className={inputClass} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={isSignup ? 'new-password' : 'current-password'} />
        </div>

        {isSignup && (
          <>
            <div>
              <Label hint="Optional">How did you hear about us?</Label>
              <select className={inputClass} value={heardAboutUs} onChange={e => setHeardAboutUs(e.target.value)}>
                <option value="">Select an option</option>
                {HEARD_ABOUT_US_OPTIONS.map(o => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            {accountType === 'worker' && (
              <div>
                <Label hint="Optional">Referral code</Label>
                <input className={inputClass} value={refCode} onChange={e => setRefCode(e.target.value.toUpperCase())} placeholder="TP-FRIEND" />
              </div>
            )}
            <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400 leading-snug cursor-pointer">
              <input type="checkbox" checked={acceptTerms} onChange={e => setAcceptTerms(e.target.checked)} className="mt-0.5 accent-pulse-500" />
              <span>
                I agree to the{' '}
                <button type="button" className="font-bold text-pulse-700 dark:text-pulse-400 underline" onClick={() => onOpenTerms('terms')}>
                  Terms of Service
                </button>{' '}
                and{' '}
                <button type="button" className="font-bold text-pulse-700 dark:text-pulse-400 underline" onClick={() => onOpenTerms('privacy')}>
                  Privacy Policy
                </button>
                .
              </span>
            </label>
          </>
        )}

        {error && <ErrorText>{error}</ErrorText>}

        <button type="submit" className={primaryButtonClass} disabled={submitting || (isSignup && !acceptTerms)}>
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSignup ? 'Create free account' : 'Sign in'}
        </button>
      </form>
    </Modal>
  );
}

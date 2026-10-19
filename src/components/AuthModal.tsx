import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Briefcase, ChevronDown, Eye, EyeOff, Loader2, Smartphone, X } from 'lucide-react';
import { emoteForError, ErrorText, Mascot } from './ui';
import { PulseEmote } from './PulseEmote';
import { HEARD_ABOUT_US_OPTIONS } from '../config/marketplace';
import {
  checkDuplicateUser,
  resendVerificationEmail,
  signInUser,
  signUpUser,
  supabase,
} from '../lib/supabaseClient';
import { celebrate } from '../lib/celebrate';
import { ChoiceButtons, Combobox, type ComboOption } from './Select';
import { HEARD_ABOUT_OPTIONS, NIGERIAN_STATES, OTHER_SCHOOL, SCHOOLS, STUDY_LEVELS, type HeardAboutId } from '../config/signupOptions';

// Old list kept importable until #13/#14 land (they edit the lines around it); the form now uses HEARD_ABOUT_OPTIONS.
void HEARD_ABOUT_US_OPTIONS;

export type AuthMode = 'signin' | 'signup' | 'verify_email' | 'forgot' | 'reset';
export type AccountType = 'worker' | 'business';

const PHONE_RE = /^0[789][01]\d{8}$/;
/** Phone is typed after a fixed +234 prefix: keep the 10 national digits (accepts pasted 080…, 234…, +234…). */
const nationalDigits = (raw: string) => {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('234')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};
const SCHOOL_OPTIONS: ComboOption[] = [
  ...SCHOOLS.map(s => ({ value: s.name, label: s.name, keywords: s.keywords })),
  { value: OTHER_SCHOOL, label: 'Other (type it in)' },
];
const STATE_OPTIONS: ComboOption[] = NIGERIAN_STATES.map(s => ({ value: s, label: s, keywords: s === 'FCT (Abuja)' ? 'federal capital territory' : undefined }));
const LEVEL_OPTIONS = STUDY_LEVELS.map(l => ({ id: l, label: l }));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const LAST_TAB_KEY = 'taskpulse_auth_tab';
const COMMON_PASSWORDS = ['password', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'password1', '11111111', '00000000', 'taskpulse'];

type Field = 'accountType' | 'fullName' | 'username' | 'phone' | 'email' | 'password' | 'confirm' | 'businessName';
type FieldErrors = Partial<Record<Field, string>>;

/** Remember whether the user last used sign in or sign up. */
export function lastAuthTab(): 'signin' | 'signup' {
  try {
    return localStorage.getItem(LAST_TAB_KEY) === 'signup' ? 'signup' : 'signin';
  } catch {
    return 'signin';
  }
}

function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (COMMON_PASSWORDS.includes(pw.toLowerCase())) return 'That password is too easy to guess. Try a longer one.';
  if (/^(.)\1+$/.test(pw)) return 'That password is too easy to guess. Try a longer one.';
  return null;
}

/** Turn Supabase / network errors into plain language. */
function friendlyAuthError(raw: string | undefined, context: 'signin' | 'signup' | 'forgot' | 'reset'): string {
  const m = (raw || '').toLowerCase();
  if (m.includes('invalid login credentials')) return "That email and password don't match. Check them, or reset your password.";
  if (m.includes('already registered') || m.includes('already exists')) return 'An account with this email already exists. Try signing in instead.';
  if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many')) return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('weak') || m.includes('pwned') || m.includes('known to be')) return 'That password is too easy to guess. Try a longer one.';
  if (m.includes('same') && m.includes('password')) return 'Your new password must be different from the old one.';
  if (m.includes('invalid_phone')) return 'Enter a valid 11-digit Nigerian mobile number, like 08012345678.';
  if (m.includes('database error')) return 'We could not create your account with those details. Check your username and phone number, then try again.';
  if (m.includes('network') || m.includes('failed to fetch')) return 'No connection. Check your internet and try again.';
  if (m.includes('session') && context === 'reset') return 'This reset link has expired. Request a new one.';
  return raw || (context === 'signin' ? 'Could not sign you in. Please try again.' : 'Something went wrong. Please try again.');
}

const fieldInput =
  'w-full h-12 px-4 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border-2 border-transparent text-[16px] font-medium text-ink dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none focus:border-pulse-500 focus:bg-white dark:focus:bg-zinc-950 transition-colors aria-[invalid=true]:border-red-500/70';

function TextField({
  label,
  hint,
  error,
  className = '',
  trailing,
  leading,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; trailing?: React.ReactNode; leading?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between px-1 mb-1.5">
        <label htmlFor={id} className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
        {hint && <span className="text-xs text-zinc-400">{hint}</span>}
      </div>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`${fieldInput} ${trailing ? 'pr-12' : ''} ${leading ? 'pl-[4.25rem]' : ''}`}
          {...input}
        />
        {leading && (
          <span aria-hidden="true" className="absolute inset-y-0 left-4 flex items-center text-[16px] font-semibold text-zinc-500 dark:text-zinc-400 pointer-events-none">
            {leading}
          </span>
        )}
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error && (
        <p id={`${id}-err`} className="text-[13px] font-medium text-red-600 dark:text-red-400 px-1 mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}

function PasswordField(props: Omit<React.ComponentProps<typeof TextField>, 'type' | 'trailing'>) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      type={show ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-500 hover:text-ink dark:hover:text-white focus-visible:outline-2 focus-visible:outline-pulse-500 cursor-pointer"
        >
          {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
        </button>
      }
    />
  );
}

const bigButton =
  'tactile w-full h-14 rounded-full bg-pulse-500 hover:bg-pulse-600 active:bg-pulse-700 text-ink text-base font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse-500';
const textLink =
  'inline-flex items-center min-h-11 px-1 text-sm font-bold text-pulse-800 dark:text-pulse-400 underline-offset-4 hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-pulse-500 rounded';

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
  onSignedIn: (accountType?: AccountType) => void;
  onOpenTerms: (tab: 'terms' | 'privacy') => void;
  notify: (title: string, subtitle: string) => void;
}) {
  const [mode, setModeState] = useState<AuthMode>(initialMode);
  // Only a business link preselects the account type; otherwise the user must choose.
  const [accountType, setAccountType] = useState<AccountType | null>(initialAccountType === 'business' ? 'business' : null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [heardAboutUs, setHeardAboutUs] = useState<HeardAboutId | ''>('');
  const [school, setSchool] = useState('');
  const [otherSchool, setOtherSchool] = useState('');
  const [level, setLevel] = useState<(typeof STUDY_LEVELS)[number] | ''>('');
  const [stateOfResidence, setStateOfResidence] = useState('');
  const [refCode, setRefCode] = useState(referralCode);
  const [showRef, setShowRef] = useState(Boolean(referralCode));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resetSent, setResetSent] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const setMode = (m: AuthMode) => {
    setModeState(m);
    setError(null);
    setFieldErrors({});
    if (m === 'signin' || m === 'signup') {
      try {
        localStorage.setItem(LAST_TAB_KEY, m);
      } catch {
        /* storage blocked */
      }
    }
    scrollRef.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (open) {
      setModeState(initialMode);
      setAccountType(initialAccountType === 'business' ? 'business' : null);
      setError(null);
      setFieldErrors({});
      setResetSent(false);
    }
  }, [open, initialMode, initialAccountType]);

  useEffect(() => {
    setRefCode(referralCode);
    if (referralCode) setShowRef(true);
  }, [referralCode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Escape closes (except while setting a new password from a recovery link).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode !== 'reset') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode, onClose]);

  if (!open) return null;

  const isSignup = mode === 'signup';
  const setFieldError = (f: Field, msg?: string) => setFieldErrors(prev => ({ ...prev, [f]: msg }));

  const checkTaken = async (field: 'email' | 'username' | 'phone') => {
    if (mode !== 'signup') return;
    const value = field === 'email' ? email.trim() : field === 'username' ? username.trim() : phone ? `0${phone}` : '';
    if (!value) return;
    if (field === 'email' && !EMAIL_RE.test(value)) return setFieldError('email', 'Enter a valid email address, like you@example.com.');
    if (field === 'username' && !USERNAME_RE.test(value)) return setFieldError('username', '3 to 30 letters, numbers or underscores.');
    if (field === 'phone' && !PHONE_RE.test(value)) return setFieldError('phone', 'Enter your 10-digit number after +234, like 801 234 5678.');
    const res = await checkDuplicateUser(field === 'email' ? value : '', field === 'username' ? value : '', field === 'phone' ? value : '');
    if (field === 'email') setFieldError('email', res.emailTaken ? 'This email already has an account. Sign in instead?' : undefined);
    if (field === 'username') setFieldError('username', res.usernameTaken ? 'That username is taken. Try another.' : undefined);
    if (field === 'phone') setFieldError('phone', res.phoneTaken ? 'This phone number is already registered.' : undefined);
  };

  const validateSignup = (): FieldErrors => {
    const errs: FieldErrors = {};
    const cleanPhone = `0${phone}`;
    if (!accountType) errs.accountType = 'Choose what brings you here.';
    if (fullName.trim().length < 2) errs.fullName = 'Enter your name as it appears on your bank account.';
    if (!USERNAME_RE.test(username.trim())) errs.username = '3 to 30 letters, numbers or underscores.';
    if (!phone) errs.phone = 'Enter your phone number.';
    else if (!PHONE_RE.test(cleanPhone)) errs.phone = 'Enter your 10-digit number after +234, like 801 234 5678.';
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address, like you@example.com.';
    const pw = passwordProblem(password);
    if (pw) errs.password = pw;
    // keep "taken" errors from the live check
    for (const f of ['email', 'username', 'phone'] as const) if (!errs[f] && fieldErrors[f]) errs[f] = fieldErrors[f];
    return errs;
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const errs = validateSignup();
    setFieldErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setError('Please fix the highlighted fields.');
      return;
    }
    if (!accountType) return;
    const schoolName = (school === OTHER_SCHOOL ? otherSchool : school).trim().slice(0, 120);
    const profileExtras: Record<string, string> = {};
    if (accountType === 'worker' && schoolName) profileExtras.school = schoolName;
    if (accountType === 'worker' && level) profileExtras.school_level = level;
    if (stateOfResidence) profileExtras.state = stateOfResidence;
    setSubmitting(true);
    const res = await signUpUser({
      email,
      password,
      username,
      fullName,
      phone: `0${phone}`,
      referralCode: refCode.trim() || undefined,
      heardAboutUs: heardAboutUs || undefined,
      profileExtras,
      accountType,
      businessName: accountType === 'business' ? businessName.trim() || fullName.trim() : undefined,
    });
    setSubmitting(false);

    if (!res.success) {
      const msg = res.error || '';
      if (/email/i.test(msg) && /exist|registered/i.test(msg)) setFieldError('email', 'This email already has an account. Sign in instead?');
      else if (/username/i.test(msg)) setFieldError('username', 'That username is taken. Try another.');
      else if (/phone/i.test(msg)) setFieldError('phone', 'This phone number is already registered.');
      setError(friendlyAuthError(msg, 'signup'));
      return;
    }
    const first = fullName.trim().split(' ')[0] || username.trim();
    if (!res.session && supabase) {
      setModeState('verify_email');
      setResendCooldown(60);
      celebrate(`You're in, ${first}!`, `Confirm your email (${email.trim()}) to start.`, {
        emote: 'excited',
        then: 'clap',
        effect: 'confetti',
        id: `signup:${email.trim().toLowerCase()}`,
      });
      return;
    }
    celebrate(`Welcome, ${first}!`, accountType === 'business' ? 'Post your first task to get started.' : 'Pick a task and start earning.', {
      emote: 'excited',
      then: 'clap',
      effect: 'confetti',
      id: `signup:${email.trim().toLowerCase()}`,
    });
    onSignedIn(accountType);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const errs: FieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter the email you signed up with.';
    if (!password) errs.password = 'Enter your password.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setSubmitting(true);
    const res = await signInUser(email, password);
    setSubmitting(false);
    if (!res.success) {
      if ((res.error || '').toLowerCase().includes('not confirmed')) {
        setModeState('verify_email');
        setResendCooldown(0);
        return;
      }
      setError(friendlyAuthError(res.error, 'signin'));
      return;
    }
    notify('Welcome back!', 'You are signed in.');
    onSignedIn();
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setFieldErrors({ email: 'Enter the email you signed up with.' });
      return;
    }
    setFieldErrors({});
    if (!supabase) {
      setError('Password reset is not available right now.');
      return;
    }
    setSubmitting(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    });
    setSubmitting(false);
    // Same message whether or not the account exists (no account probing),
    // except for rate limits, which the user needs to know about.
    if (err && /rate|security purposes|too many/i.test(err.message)) {
      setError(friendlyAuthError(err.message, 'forgot'));
      return;
    }
    setResetSent(true);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const errs: FieldErrors = {};
    const pw = passwordProblem(password);
    if (pw) errs.password = pw;
    if (confirm !== password) errs.confirm = "Passwords don't match.";
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    if (!supabase) return;
    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (err) {
      setError(friendlyAuthError(err.message, 'reset'));
      return;
    }
    setPassword('');
    setConfirm('');
    notify('Password updated', 'You are signed in with your new password.');
    onSignedIn();
  };

  const handleResend = async () => {
    if (!email || resendCooldown > 0) return;
    const res = await resendVerificationEmail(email);
    if (res.success) {
      setResendCooldown(60);
      notify('Email sent', `Check ${email.trim()} (and your spam folder).`);
    } else {
      setError(friendlyAuthError(res.error, 'signup'));
    }
  };

  // ---------------------------------------------------------------- layout
  const headline =
    mode === 'signin'
      ? 'Welcome back'
      : mode === 'signup'
      ? 'Get paid for real tasks. No deposit, ever.'
      : mode === 'forgot'
      ? resetSent
        ? 'Check your email'
        : 'Reset your password'
      : mode === 'reset'
      ? 'Choose a new password'
      : 'Confirm your email';
  const sub =
    mode === 'signin'
      ? 'Sign in to see your tasks and earnings.'
      : mode === 'signup'
      ? 'Free to join. Takes about a minute.'
      : mode === 'forgot'
      ? resetSent
        ? `If ${email.trim() || 'that email'} has an account, we've sent a link to reset your password.`
        : "Enter your email and we'll send you a reset link."
      : mode === 'reset'
      ? 'Use at least 8 characters.'
      : `We sent a link to ${email.trim() || 'your email'}. Open it, then come back and sign in.`;
  const pose = mode === 'verify_email' ? 'celebrating' : mode === 'forgot' || mode === 'reset' ? 'thinking' : 'happy';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="fixed inset-0 z-50 bg-zinc-100 dark:bg-black flex justify-center"
    >
      <div ref={scrollRef} className="relative w-full max-w-md h-[100dvh] overflow-y-auto no-scrollbar bg-white dark:bg-ink">
        <div className="px-6 pt-[calc(env(safe-area-inset-top)+12px)] pb-[calc(env(safe-area-inset-bottom)+28px)]">
          {/* Top bar */}
          <div className="flex items-center justify-between h-14">
            {mode === 'forgot' ? (
              <button type="button" onClick={() => setMode('signin')} aria-label="Back to sign in" className="tactile w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-ink dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer focus-visible:outline-2 focus-visible:outline-pulse-500">
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <span className="w-11" />
            )}
            <img src="/brand/logo-lockup-light.png" alt="TaskPulse" className="h-10 w-auto logo-on-light dark:hidden" draggable={false} />
            <img src="/brand/logo-lockup-dark.png" alt="TaskPulse" className="h-10 w-auto logo-on-dark hidden dark:block" draggable={false} />
            {mode !== 'reset' ? (
              <button type="button" onClick={onClose} aria-label="Close" className="tactile w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer focus-visible:outline-2 focus-visible:outline-pulse-500">
                <X className="w-5 h-5" />
              </button>
            ) : (
              <span className="w-11" />
            )}
          </div>

          {/* Hero */}
          <div className="flex items-center gap-4 mt-4 mb-6">
            {error && emoteForError(error) === 'tired' ? (
              <PulseEmote name="tired" size={96} alt="" className="shrink-0" />
            ) : (
              <Mascot pose={pose} className="w-24 h-24 shrink-0" bob={mode === 'verify_email'} />
            )}
            <div className="min-w-0">
              <h1 id={headingId} className="text-[26px] leading-[1.15] font-extrabold tracking-tight text-ink dark:text-white">
                {headline}
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">{sub}</p>
            </div>
          </div>

          {(mode === 'signin' || mode === 'signup') && (
            <div role="tablist" aria-label="Sign in or create account" className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-full bg-zinc-100 dark:bg-zinc-900">
              {(['signin', 'signup'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`h-11 rounded-full text-sm font-bold cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-pulse-500 ${
                    mode === m ? 'bg-white dark:bg-zinc-800 text-ink dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {m === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}

          {/* ------------------------------ SIGN UP */}
          {mode === 'signup' && (
            <form onSubmit={handleSignUp} noValidate className="space-y-4">
              <fieldset aria-describedby={fieldErrors.accountType ? 'account-type-err' : undefined}>
                <legend className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 px-1 mb-2">What brings you here?</legend>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { id: 'worker', label: 'I want to earn', note: 'Do tasks, get paid to your bank', icon: <Smartphone className="w-5 h-5" /> },
                    { id: 'business', label: 'I want to post tasks', note: 'Get real people to do tasks', icon: <Briefcase className="w-5 h-5" /> },
                  ] as const).map(opt => {
                    const selected = accountType === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`relative block p-4 min-h-[112px] rounded-3xl border-2 cursor-pointer transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-pulse-500 ${
                          selected ? 'border-pulse-500 bg-pulse-500/10' : fieldErrors.accountType ? 'border-red-500/70' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                        }`}
                      >
                        <input type="radio" name="account-type" value={opt.id} checked={selected} onChange={() => { setAccountType(opt.id); setFieldError('accountType'); }} required className="sr-only" />
                        <span className={`w-9 h-9 rounded-full flex items-center justify-center ${selected ? 'bg-pulse-500 text-ink' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300'}`}>
                          {opt.icon}
                        </span>
                        <span className="block text-[15px] font-extrabold text-ink dark:text-white mt-2 leading-tight">{opt.label}</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-snug">{opt.note}</span>
                      </label>
                    );
                  })}
                </div>
                {fieldErrors.accountType && (
                  <p id="account-type-err" role="alert" className="text-[13px] font-medium text-red-600 dark:text-red-400 px-1 mt-1.5">
                    {fieldErrors.accountType}
                  </p>
                )}
              </fieldset>

              <TextField label="Full name" hint="As on your bank account" value={fullName} onChange={e => { setFullName(e.target.value); setFieldError('fullName'); }} placeholder="Chiamaka Obi" autoComplete="name" autoCapitalize="words" enterKeyHint="next" error={fieldErrors.fullName} />
              {accountType === 'business' && (
                <TextField label="Business name" hint="Optional" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Acme Foods Ltd" autoComplete="organization" enterKeyHint="next" />
              )}
              <TextField label="Username" value={username} onChange={e => { setUsername(e.target.value.replace(/\s/g, '')); setFieldError('username'); }} onBlur={() => checkTaken('username')} placeholder="chiamaka" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" error={fieldErrors.username} />
              <TextField label="Phone number" hint="Nigerian mobile" leading="+234" value={phone} onChange={e => { setPhone(nationalDigits(e.target.value)); setFieldError('phone'); }} onBlur={() => checkTaken('phone')} placeholder="801 234 5678" type="tel" inputMode="numeric" autoComplete="tel-national" enterKeyHint="next" error={fieldErrors.phone} />
              <TextField label="Email" value={email} onChange={e => { setEmail(e.target.value); setFieldError('email'); }} onBlur={() => checkTaken('email')} placeholder="you@example.com" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" error={fieldErrors.email} />
              <PasswordField label="Password" value={password} onChange={e => { setPassword(e.target.value); setFieldError('password'); }} onBlur={() => password && setFieldError('password', passwordProblem(password) || undefined)} placeholder="At least 8 characters" autoComplete="new-password" enterKeyHint="next" error={fieldErrors.password} />

              {accountType !== 'business' && (
                <>
                  <Combobox
                    label="School"
                    hint="Optional"
                    value={school}
                    onChange={setSchool}
                    options={SCHOOL_OPTIONS}
                    pinned={[OTHER_SCHOOL]}
                    placeholder="Select your school"
                    emptyText="Not listed? Choose “Other”."
                  />
                  {school === OTHER_SCHOOL && (
                    <TextField label="School name" hint="Optional" value={otherSchool} onChange={e => setOtherSchool(e.target.value)} placeholder="Type your school" autoCapitalize="words" maxLength={120} enterKeyHint="next" />
                  )}
                  <ChoiceButtons label="Level" hint="Optional" value={level} onChange={v => setLevel(l => (l === v ? '' : v))} options={LEVEL_OPTIONS} />
                </>
              )}
              <Combobox label="State" hint="Optional" value={stateOfResidence} onChange={setStateOfResidence} options={STATE_OPTIONS} placeholder="Select your state" />
              <ChoiceButtons
                label="Where did you hear about TaskPulse?"
                hint="Optional"
                value={heardAboutUs}
                onChange={v => setHeardAboutUs(h => (h === v ? '' : v))}
                options={HEARD_ABOUT_OPTIONS}
              />

              {accountType !== 'business' && (
                <div>
                  <button type="button" onClick={() => setShowRef(s => !s)} aria-expanded={showRef} className={textLink}>
                    {showRef ? 'Referral code' : 'Have a referral code?'}
                    <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showRef ? 'rotate-180' : ''}`} />
                  </button>
                  {showRef && (
                    <TextField label="Referral code" hint="Optional" value={refCode} onChange={e => setRefCode(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="TP-FRIEND" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={40} className="mt-1" />
                  )}
                </div>
              )}

              {error && <ErrorText>{error}</ErrorText>}

              <button type="submit" className={bigButton} disabled={submitting}>
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                {submitting ? 'Creating your account…' : accountType === 'business' ? 'Create business account' : 'Create my account'}
              </button>

              <p className="text-xs text-center text-zinc-500 dark:text-zinc-400 leading-relaxed px-2">
                By creating an account you agree to our{' '}
                <button type="button" className="font-semibold underline underline-offset-2 text-ink dark:text-white cursor-pointer" onClick={() => onOpenTerms('terms')}>
                  Terms
                </button>{' '}
                and{' '}
                <button type="button" className="font-semibold underline underline-offset-2 text-ink dark:text-white cursor-pointer" onClick={() => onOpenTerms('privacy')}>
                  Privacy Policy
                </button>
                .
              </p>
              <p className="text-sm text-center text-zinc-500 dark:text-zinc-400">
                Already have an account?{' '}
                <button type="button" className={textLink} onClick={() => setMode('signin')}>
                  Sign in
                </button>
              </p>
            </form>
          )}

          {/* ------------------------------ SIGN IN */}
          {mode === 'signin' && (
            <form onSubmit={handleSignIn} noValidate className="space-y-4">
              <TextField label="Email" value={email} onChange={e => { setEmail(e.target.value); setFieldError('email'); }} placeholder="you@example.com" type="email" inputMode="email" autoComplete="username email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" error={fieldErrors.email} autoFocus />
              <PasswordField label="Password" value={password} onChange={e => { setPassword(e.target.value); setFieldError('password'); }} placeholder="Your password" autoComplete="current-password" enterKeyHint="go" error={fieldErrors.password} />
              <div className="flex justify-end -mt-1">
                <button type="button" className={textLink} onClick={() => setMode('forgot')}>
                  Forgot password?
                </button>
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <button type="submit" className={bigButton} disabled={submitting}>
                {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
              <p className="text-sm text-center text-zinc-500 dark:text-zinc-400">
                New to TaskPulse?{' '}
                <button type="button" className={textLink} onClick={() => setMode('signup')}>
                  Create a free account
                </button>
              </p>
            </form>
          )}

          {/* ------------------------------ FORGOT */}
          {mode === 'forgot' &&
            (resetSent ? (
              <div className="space-y-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400 px-1">The link opens TaskPulse so you can choose a new password. It can take a minute to arrive. Check your spam folder too.</p>
                <button type="button" className={bigButton} onClick={() => setMode('signin')}>
                  Back to sign in
                </button>
                <button type="button" className={`${textLink} w-full justify-center`} onClick={() => setResetSent(false)}>
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgot} noValidate className="space-y-4">
                <TextField label="Email" value={email} onChange={e => { setEmail(e.target.value); setFieldError('email'); }} placeholder="you@example.com" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send" error={fieldErrors.email} autoFocus />
                {error && <ErrorText>{error}</ErrorText>}
                <button type="submit" className={bigButton} disabled={submitting}>
                  {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
                  {submitting ? 'Sending…' : 'Send reset link'}
                </button>
                <p className="text-sm text-center text-zinc-500 dark:text-zinc-400">
                  Remembered it?{' '}
                  <button type="button" className={textLink} onClick={() => setMode('signin')}>
                    Sign in
                  </button>
                </p>
              </form>
            ))}

          {/* ------------------------------ RESET (from recovery link) */}
          {mode === 'reset' && (
            <form onSubmit={handleReset} noValidate className="space-y-4">
              <PasswordField label="New password" value={password} onChange={e => { setPassword(e.target.value); setFieldError('password'); }} placeholder="At least 8 characters" autoComplete="new-password" enterKeyHint="next" error={fieldErrors.password} autoFocus />
              <PasswordField label="Confirm new password" value={confirm} onChange={e => { setConfirm(e.target.value); setFieldError('confirm'); }} placeholder="Type it again" autoComplete="new-password" enterKeyHint="done" error={fieldErrors.confirm} />
              {error && <ErrorText>{error}</ErrorText>}
              <button type="submit" className={bigButton} disabled={submitting}>
                {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
                {submitting ? 'Saving…' : 'Save new password'}
              </button>
              {error && /expired/i.test(error) && (
                <button type="button" className={`${textLink} w-full justify-center`} onClick={() => setMode('forgot')}>
                  Send me a new link
                </button>
              )}
            </form>
          )}

          {/* ------------------------------ VERIFY EMAIL */}
          {mode === 'verify_email' && (
            <div className="space-y-4">
              {error && <ErrorText>{error}</ErrorText>}
              <button type="button" className={bigButton} onClick={() => setMode('signin')}>
                I've confirmed, sign in
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || !email}
                className={`${textLink} w-full justify-center disabled:opacity-50 disabled:no-underline`}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend confirmation email'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

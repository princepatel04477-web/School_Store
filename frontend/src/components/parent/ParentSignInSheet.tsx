import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from '../ui/icons';
import { auth as authApi, parentChildren, type ParentChild } from '../../api';
import { useAuth } from '../../auth';
import { SchoolCrest } from '../school/SchoolCrest';
import { EASING } from '../../motion/motionConfig';
import './parentSignIn.css';

type Step = 'phone' | 'otp' | 'children' | 'find';

export interface ParentSignInSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen child, or null if the parent skipped that step. */
  onDone: (child: ParentChild | null) => void;
  /** School the parent picked in the shop, used to pre-select it in the find form. */
  schoolName?: string;
}

const RESEND_SECONDS = 30;

function classLabel(child: ParentChild) {
  const cls = child.grade_name || child.class_name;
  return [cls, child.section && `Section ${child.section}`].filter(Boolean).join(' · ');
}

/**
 * Parent sign-in in as few fields as possible:
 * mobile number -> OTP -> tap your child. Children come from the school's list
 * (no typing). Only when the school's list has no phone for this parent do we
 * ask for two things: GR number and date of birth.
 */
export function ParentSignInSheet({ open, onClose, onDone, schoolName }: ParentSignInSheetProps) {
  const { user, signInWithOtp } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [testCode, setTestCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [children, setChildren] = useState<ParentChild[]>([]);
  const [schools, setSchools] = useState<{ id: string; name: string; code: string }[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [grNumber, setGrNumber] = useState('');
  const [dob, setDob] = useState('');
  const otpRef = useRef<HTMLInputElement>(null);

  // Already signed in: go straight to the children
  useEffect(() => {
    if (!open) return;
    setError('');
    if (user?.role === 'PARENT') {
      void loadChildren();
    } else {
      setStep('phone');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  // Android Chrome can read the OTP from the SMS without the parent typing it
  useEffect(() => {
    if (step !== 'otp' || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    (navigator.credentials as any)
      ?.get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((cred: { code?: string } | null) => {
        if (cred?.code) setOtp(cred.code);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [step]);

  const digits = phone.replace(/\D/g, '').slice(-10);
  const phoneValid = /^[6-9]\d{9}$/.test(digits);

  async function sendOtp(e?: FormEvent) {
    e?.preventDefault();
    if (!phoneValid || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await authApi.sendOtp(digits);
      setTestCode(res.otp_debug ?? null);
      setOtp('');
      setStep('otp');
      setResendIn(RESEND_SECONDS);
      window.setTimeout(() => otpRef.current?.focus(), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the OTP. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    try {
      await signInWithOtp(digits, code);
      await loadChildren();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That OTP is wrong or has expired.');
      setOtp('');
    } finally {
      setBusy(false);
    }
  }

  // Submit as soon as six digits are in
  useEffect(() => {
    if (step === 'otp' && otp.length === 6) void verify(otp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  async function loadChildren() {
    try {
      const res = await parentChildren.list();
      const kids = (res.results ?? []).filter((c) => c.active);
      setChildren(kids);
      if (kids.length > 0) {
        setStep('children');
      } else {
        await openFind();
      }
    } catch {
      await openFind();
    }
  }

  async function openFind() {
    setStep('find');
    if (schools.length) return;
    try {
      const list = await parentChildren.schools();
      setSchools(list);
      const hint = (schoolName || '').trim().toLowerCase();
      const match = hint ? list.find((s) => s.name.trim().toLowerCase() === hint) : undefined;
      if (match) setSchoolId(match.id);
      else if (list.length === 1) setSchoolId(list[0].id);
    } catch {
      setError('Could not load the list of schools. Check your connection.');
    }
  }

  async function claim(e: FormEvent) {
    e.preventDefault();
    if (!schoolId || !grNumber.trim() || !dob || busy) return;
    setBusy(true);
    setError('');
    try {
      const child = await parentChildren.claim(schoolId, grNumber.trim(), dob);
      onDone(child);
    } catch (err) {
      setError(
        err instanceof Error && err.message !== 'Something went wrong'
          ? err.message
          : 'We could not find your child with those details. Check the GR number on the school diary or fee receipt.'
      );
    } finally {
      setBusy(false);
    }
  }

  const title = useMemo(
    () =>
      ({
        phone: 'Sign in to order',
        otp: 'Enter the OTP',
        children: children.length > 1 ? 'Who are you ordering for?' : 'Is this your child?',
        find: 'Find your child',
      })[step],
    [step, children.length]
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="psi-backdrop"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASING }}
        >
          <motion.div
            className="psi-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="psi-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.35, ease: EASING }}
          >
            <div className="psi-grab" aria-hidden="true" />
            <div className="psi-head">
              <h2 id="psi-title">{title}</h2>
              <button type="button" className="psi-close" aria-label="Close" onClick={onClose}>
                <X width={20} height={20} strokeWidth={1.75} />
              </button>
            </div>

            {step === 'phone' && (
              <form className="psi-body" onSubmit={sendOtp}>
                <p className="psi-lead">We'll send a 6-digit code. No password needed.</p>
                <label className="psi-label" htmlFor="psi-phone">
                  Mobile number
                </label>
                <div className="psi-phone">
                  <span className="psi-cc">+91</span>
                  <input
                    id="psi-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="98200 11223"
                    maxLength={14}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ''))}
                    autoFocus
                  />
                </div>
                {error && <p className="psi-error" role="alert">{error}</p>}
                <button type="submit" className="btn btn-primary psi-cta" disabled={!phoneValid || busy}>
                  {busy ? 'Sending…' : 'Send OTP'}
                </button>
              </form>
            )}

            {step === 'otp' && (
              <div className="psi-body">
                <p className="psi-lead">
                  Sent to +91 {digits.slice(0, 5)} {digits.slice(5)}.{' '}
                  <button type="button" className="psi-link" onClick={() => setStep('phone')}>
                    Change
                  </button>
                </p>
                <input
                  ref={otpRef}
                  id="psi-otp"
                  className="psi-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label="6-digit OTP"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                {testCode && <p className="psi-test">Test mode: your code is {testCode}</p>}
                {error && <p className="psi-error" role="alert">{error}</p>}
                <p className="psi-resend">
                  {resendIn > 0 ? (
                    `Resend in ${resendIn}s`
                  ) : (
                    <button type="button" className="psi-link" onClick={() => void sendOtp()}>
                      Resend OTP
                    </button>
                  )}
                </p>
                {busy && <p className="psi-lead">Checking…</p>}
              </div>
            )}

            {step === 'children' && (
              <div className="psi-body">
                <p className="psi-lead">From your school's records. Tap to continue.</p>
                <ul className="psi-kids">
                  {children.map((child) => (
                    <li key={child.id}>
                      <button type="button" className="psi-kid" onClick={() => onDone(child)}>
                        <SchoolCrest name={child.school_name} code={child.school_code} size={40} />
                        <span className="psi-kid-text">
                          <strong>{child.name}</strong>
                          <span>{classLabel(child)}</span>
                          <span className="psi-kid-school">{child.school_name}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="psi-link psi-other" onClick={() => void openFind()}>
                  Add another child
                </button>
              </div>
            )}

            {step === 'find' && (
              <form className="psi-body" onSubmit={claim}>
                <p className="psi-lead">
                  Two details from the school diary or fee receipt. Everything else is filled in from the school's records.
                </p>
                {schools.length !== 1 ? (
                  <>
                    <label className="psi-label" htmlFor="psi-school">
                      School
                    </label>
                    <select
                      id="psi-school"
                      className="psi-input"
                      value={schoolId}
                      onChange={(e) => setSchoolId(e.target.value)}
                    >
                      <option value="">Choose your school</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
                <label className="psi-label" htmlFor="psi-gr">
                  GR number
                </label>
                <input
                  id="psi-gr"
                  className="psi-input"
                  type="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="e.g. 2019/0832"
                  value={grNumber}
                  onChange={(e) => setGrNumber(e.target.value)}
                />
                <label className="psi-label" htmlFor="psi-dob">
                  Child's date of birth
                </label>
                <input
                  id="psi-dob"
                  className="psi-input"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
                {error && <p className="psi-error" role="alert">{error}</p>}
                <button
                  type="submit"
                  className="btn btn-primary psi-cta"
                  disabled={!schoolId || !grNumber.trim() || !dob || busy}
                >
                  {busy ? 'Finding…' : 'Find my child'}
                </button>
                <button type="button" className="psi-link psi-other" onClick={() => onDone(null)}>
                  Skip for now
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

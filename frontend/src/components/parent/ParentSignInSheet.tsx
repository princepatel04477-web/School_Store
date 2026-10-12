import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from '../ui/icons';
import { ApiError, auth as authApi, parentChildren, type ParentChild } from '../../api';
import { useLang, type MessageKey } from '../../i18n';
import { classLabel as translateClass } from '../../i18n/labels';
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

type T = ReturnType<typeof useLang>['t'];

function classLabel(child: ParentChild, t: T) {
  const cls = translateClass(child.grade_name || child.class_name, t);
  return [cls, child.section && t('co.section', { s: child.section })].filter(Boolean).join(' · ');
}

/** The server's reasons, in the parent's language. */
function sendError(err: unknown): MessageKey {
  if (!(err instanceof ApiError)) return 'err.offline';
  if (err.data.code === 'sms_unavailable') return 'signin.smsOff';
  if (err.data.code === 'sms_failed') return 'signin.smsFailed';
  if (err.status === 429) return 'signin.tooMany';
  if (err.status === 400) return 'co.err.mobile';
  return 'signin.sendFailed';
}

/**
 * Parent sign-in in as few fields as possible:
 * mobile number -> OTP -> tap your child. Children come from the school's list
 * (no typing). Only when the school's list has no phone for this parent do we
 * ask for two things: GR number and date of birth.
 */
export function ParentSignInSheet({ open, onClose, onDone, schoolName }: ParentSignInSheetProps) {
  const { user, signInWithOtp } = useAuth();
  const { t } = useLang();
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
      setError(t(sendError(err)));
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
      setError(
        t(!(err instanceof ApiError) ? 'err.offline' : err.status === 429 ? 'signin.tooMany' : 'signin.wrongOtp')
      );
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
      setError(t('flow.schoolsError'));
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
      setError(t(err instanceof ApiError ? 'signin.notFound' : 'err.offline'));
    } finally {
      setBusy(false);
    }
  }

  const title = useMemo(
    () =>
      ({
        phone: t('signin.title'),
        otp: t('signin.otpTitle'),
        children: children.length > 1 ? t('signin.whichChild') : t('signin.isThisChild'),
        find: t('signin.findTitle'),
      })[step],
    [step, children.length, t]
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
              <button type="button" className="psi-close" aria-label={t('common.close')} onClick={onClose}>
                <X width={20} height={20} strokeWidth={1.75} />
              </button>
            </div>

            {step === 'phone' && (
              <form className="psi-body" onSubmit={sendOtp}>
                <p className="psi-lead">{t('signin.lead')}</p>
                <label className="psi-label" htmlFor="psi-phone">
                  {t('co.mobile')}
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
                  {busy ? t('signin.sending') : t('signin.send')}
                </button>
              </form>
            )}

            {step === 'otp' && (
              <div className="psi-body">
                <p className="psi-lead">
                  {t('signin.sentTo', { mobile: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` })}{' '}
                  <button type="button" className="psi-link" onClick={() => setStep('phone')}>
                    {t('nav.change')}
                  </button>
                </p>
                <input
                  ref={otpRef}
                  id="psi-otp"
                  className="psi-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label={t('signin.otpTitle')}
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                {testCode && <p className="psi-test">{t('signin.testCode', { code: testCode })}</p>}
                {error && <p className="psi-error" role="alert">{error}</p>}
                <p className="psi-resend">
                  {resendIn > 0 ? (
                    t('signin.resendIn', { s: resendIn })
                  ) : (
                    <button type="button" className="psi-link" onClick={() => void sendOtp()}>
                      {t('signin.resend')}
                    </button>
                  )}
                </p>
                {busy && <p className="psi-lead">{t('signin.checking')}</p>}
              </div>
            )}

            {step === 'children' && (
              <div className="psi-body">
                <p className="psi-lead">{t('signin.fromRecords')}</p>
                <ul className="psi-kids">
                  {children.map((child) => (
                    <li key={child.id}>
                      <button type="button" className="psi-kid" onClick={() => onDone(child)}>
                        <SchoolCrest name={child.school_name} code={child.school_code} size={40} />
                        <span className="psi-kid-text">
                          <strong>{child.name}</strong>
                          <span>{classLabel(child, t)}</span>
                          <span className="psi-kid-school">{child.school_name}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="psi-link psi-other" onClick={() => void openFind()}>
                  {t('signin.addChild')}
                </button>
              </div>
            )}

            {step === 'find' && (
              <form className="psi-body" onSubmit={claim}>
                <p className="psi-lead">
                  {t('signin.findLead')}
                </p>
                {schools.length !== 1 ? (
                  <>
                    <label className="psi-label" htmlFor="psi-school">
                      {t('flow.school')}
                    </label>
                    <select
                      id="psi-school"
                      className="psi-input"
                      value={schoolId}
                      onChange={(e) => setSchoolId(e.target.value)}
                    >
                      <option value="">{t('flow.chooseSchool')}</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
                <label className="psi-label" htmlFor="psi-gr">
                  {t('signin.gr')}
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
                  {t('signin.dob')}
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
                  {busy ? t('signin.finding') : t('signin.find')}
                </button>
                <button type="button" className="psi-link psi-other" onClick={() => onDone(null)}>
                  {t('signin.skip')}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

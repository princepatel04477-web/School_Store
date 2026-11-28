import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { KeyIcon, Smartphone, UserPlus, X } from '../ui/icons';
import { ApiError, auth as authApi, parentChildren, type ParentChild } from '../../api';
import { useLang, type MessageKey } from '../../i18n';
import { classLabel as translateClass } from '../../i18n/labels';
import { useAuth } from '../../auth';
import { SchoolCrest } from '../school/SchoolCrest';
import { EASING } from '../../motion/motionConfig';
import './parentSignIn.css';

export type SignInStep = 'choose' | 'phone' | 'otp' | 'password' | 'register' | 'children' | 'find';
type Step = SignInStep;

export interface ParentSignInSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen child, or null if the parent skipped that step. */
  onDone: (child: ParentChild | null) => void;
  /** School the parent picked in the shop, used to pre-select it in the find form. */
  schoolName?: string;
  /** Skip the child-picker step after OTP verification (used on /account). */
  skipChildPicker?: boolean;
  /** Screen to open on. Defaults to the choice between OTP and a user ID. */
  initialStep?: 'choose' | 'phone' | 'password' | 'register';
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

/** User IDs: small letters, numbers, dot and underscore, with at least one letter. */
const USER_ID = /^(?=.*[a-z])[a-z0-9._]{4,30}$/;
const MIN_PASSWORD = 6;

/** The server's field errors on create account, in the parent's language. */
function registerError(err: unknown): MessageKey {
  if (!(err instanceof ApiError)) return 'err.offline';
  if (err.status === 429) return 'signin.tooMany';
  const field = (name: string) => {
    const v = err.data[name];
    return Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '';
  };
  if (field('phone')) return /exist/i.test(field('phone')) ? 'signin.phoneTaken' : 'co.err.mobile';
  if (field('username')) return /taken|exist/i.test(field('username')) ? 'signin.idTaken' : 'signin.errUserId';
  if (field('password')) return 'signin.errPassword';
  return 'signin.createFailed';
}

/**
 * Parent sign-in. The first screen offers two ways in: a mobile number and OTP
 * (the account is made on first use), or a user ID and password the parent
 * picks. Returning parents can sign in with that user ID and password.
 *
 * After OTP: as few fields as possible:
 * mobile number -> OTP -> tap your child. Children come from the school's list
 * (no typing). Only when the school's list has no phone for this parent do we
 * ask for two things: GR number and date of birth.
 */
export function ParentSignInSheet({
  open,
  onClose,
  onDone,
  schoolName,
  skipChildPicker = false,
  initialStep = 'choose',
}: ParentSignInSheetProps) {
  const { user, signIn, signUp, signInWithOtp } = useAuth();
  const { t } = useLang();
  const [step, setStep] = useState<Step>(initialStep);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [userId, setUserId] = useState('');
  const [phoneTaken, setPhoneTaken] = useState(false);
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
    setPhoneTaken(false);
    if (user?.role === 'PARENT') {
      if (skipChildPicker) onDone(null);
      else void loadChildren();
    } else {
      setStep(initialStep);
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
    if (step !== 'otp' || testCode || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    (navigator.credentials as any)
      ?.get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((cred: { code?: string } | null) => {
        if (cred?.code) setOtp(cred.code);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [step, testCode]);

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
      const { user: signedIn } = await signInWithOtp(digits, code);
      await afterSignIn(signedIn.role);
    } catch (err) {
      let message: MessageKey = 'err.offline';
      if (err instanceof ApiError) {
        if (err.status === 400) message = 'signin.wrongOtp';
        else if (err.status === 429) message = 'signin.tooMany';
        else message = 'signin.verifyFailed';
      }
      setError(t(message));
      setOtp('');
    } finally {
      setBusy(false);
    }
  }

  /** After any sign-in: parents go on to their child, anyone else is done. */
  async function afterSignIn(role: string) {
    if (skipChildPicker || role !== 'PARENT') {
      onDone(null);
      return;
    }
    await loadChildren();
  }

  function go(next: Step) {
    setError('');
    setPhoneTaken(false);
    setShowPassword(false);
    setStep(next);
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    const id = loginId.trim();
    if (!id || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      const signedIn = await signIn(id, password);
      await afterSignIn(signedIn.role);
    } catch (err) {
      let message: MessageKey = 'err.offline';
      if (err instanceof ApiError) {
        if (err.status === 429) message = 'signin.tooMany';
        else if (err.status === 400 || err.status === 401) message = 'signin.wrongPassword';
        else message = 'signin.verifyFailed';
      }
      setError(t(message));
    } finally {
      setBusy(false);
    }
  }

  const userIdValid = USER_ID.test(userId);
  const nameValid = fullName.trim().length >= 2;
  const newPasswordValid = password.length >= MIN_PASSWORD;

  async function submitRegister(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!nameValid) return setError(t('signin.errName'));
    if (!phoneValid) return setError(t('co.err.mobile'));
    if (!userIdValid) return setError(t('signin.errUserId'));
    if (!newPasswordValid) return setError(t('signin.errPassword'));
    setBusy(true);
    setError('');
    setPhoneTaken(false);
    const [first, ...rest] = fullName.trim().split(/\s+/);
    try {
      const signedIn = await signUp({
        phone: digits,
        username: userId,
        password,
        first_name: first,
        last_name: rest.join(' '),
      });
      await afterSignIn(signedIn.role);
    } catch (err) {
      const message = registerError(err);
      setPhoneTaken(message === 'signin.phoneTaken');
      setError(t(message));
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
        choose: t('signin.chooseTitle'),
        phone: t('signin.optOtp'),
        password: t('signin.passwordTitle'),
        register: t('signin.createTitle'),
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

            {step === 'choose' && (
              <div className="psi-body">
                <p className="psi-lead">{t('signin.chooseLead')}</p>
                <button type="button" className="psi-choice" onClick={() => go('phone')}>
                  <Smartphone width={28} height={28} strokeWidth={1.6} className="psi-choice-icon" />
                  <span className="psi-choice-text">
                    <strong>{t('signin.optOtp')}</strong>
                    <span>{t('signin.optOtpHint')}</span>
                  </span>
                </button>
                <button type="button" className="psi-choice" onClick={() => go('register')}>
                  <UserPlus width={28} height={28} strokeWidth={1.6} className="psi-choice-icon" />
                  <span className="psi-choice-text">
                    <strong>{t('signin.optCreate')}</strong>
                    <span>{t('signin.optCreateHint')}</span>
                  </span>
                </button>
                <button type="button" className="psi-choice psi-choice-quiet" onClick={() => go('password')}>
                  <KeyIcon width={24} height={24} strokeWidth={1.6} className="psi-choice-icon" />
                  <span className="psi-choice-text">
                    <strong>{t('signin.optPassword')}</strong>
                  </span>
                </button>
              </div>
            )}

            {step === 'password' && (
              <form className="psi-body" onSubmit={submitPassword}>
                <label className="psi-label" htmlFor="psi-login">
                  {t('signin.idOrMobile')}
                </label>
                <input
                  id="psi-login"
                  className="psi-input"
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  autoFocus
                />
                <label className="psi-label" htmlFor="psi-password">
                  {t('signin.password')}
                </label>
                <div className="psi-password">
                  <input
                    id="psi-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="psi-reveal" onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? t('signin.hide') : t('signin.show')}
                  </button>
                </div>
                {error && <p className="psi-error" role="alert">{error}</p>}
                <button type="submit" className="btn btn-primary psi-cta" disabled={!loginId.trim() || !password || busy}>
                  {busy ? t('signin.signingIn') : t('signin.signIn')}
                </button>
                <div className="psi-links">
                  <button type="button" className="psi-link" onClick={() => go('phone')}>
                    {t('signin.forgot')}
                  </button>
                  <button type="button" className="psi-link" onClick={() => go('register')}>
                    {t('signin.noAccount')}
                  </button>
                  <button type="button" className="psi-link" onClick={() => go('choose')}>
                    {t('signin.otherWays')}
                  </button>
                </div>
              </form>
            )}

            {step === 'register' && (
              <form className="psi-body" onSubmit={submitRegister} noValidate>
                <p className="psi-lead">{t('signin.createLead')}</p>
                <label className="psi-label" htmlFor="psi-name">
                  {t('signin.name')}
                </label>
                <input
                  id="psi-name"
                  className="psi-input"
                  type="text"
                  autoComplete="name"
                  autoCapitalize="words"
                  maxLength={80}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoFocus
                />
                <label className="psi-label" htmlFor="psi-reg-phone">
                  {t('co.mobile')}
                </label>
                <div className="psi-phone">
                  <span className="psi-cc">+91</span>
                  <input
                    id="psi-reg-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="98200 11223"
                    maxLength={14}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ''))}
                  />
                </div>
                <label className="psi-label" htmlFor="psi-userid">
                  {t('signin.userId')}
                </label>
                <input
                  id="psi-userid"
                  className="psi-input"
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  maxLength={30}
                  placeholder="e.g. ravi.patel"
                  aria-describedby="psi-userid-hint"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
                />
                <p className="psi-hint" id="psi-userid-hint">{t('signin.userIdHint')}</p>
                <label className="psi-label" htmlFor="psi-new-password">
                  {t('signin.newPassword')}
                </label>
                <div className="psi-password">
                  <input
                    id="psi-new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    aria-describedby="psi-password-hint"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="psi-reveal" onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? t('signin.hide') : t('signin.show')}
                  </button>
                </div>
                <p className="psi-hint" id="psi-password-hint">{t('signin.passwordHint')}</p>
                {error && <p className="psi-error" role="alert">{error}</p>}
                {phoneTaken && (
                  <button type="button" className="btn btn-secondary psi-cta" onClick={() => go('phone')}>
                    {t('signin.optOtp')}
                  </button>
                )}
                <button type="submit" className="btn btn-primary psi-cta" disabled={busy}>
                  {busy ? t('signin.creating') : t('signin.create')}
                </button>
                <div className="psi-links">
                  <button type="button" className="psi-link" onClick={() => go('password')}>
                    {t('signin.haveAccount')}
                  </button>
                  <button type="button" className="psi-link" onClick={() => go('choose')}>
                    {t('signin.otherWays')}
                  </button>
                </div>
              </form>
            )}

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
                <div className="psi-links">
                  <button type="button" className="psi-link" onClick={() => go('choose')}>
                    {t('signin.otherWays')}
                  </button>
                </div>
              </form>
            )}

            {step === 'otp' && (
              <div className="psi-body">
                <p className="psi-lead">
                  {t('signin.sentTo', { mobile: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` })}{' '}
                  <button type="button" className="psi-link" onClick={() => go('phone')}>
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
                {testCode && (
                  <p className="psi-test">
                    {t('signin.testCode', { code: testCode })}{' '}
                    <button type="button" className="psi-link" disabled={busy} onClick={() => void verify(testCode)}>
                      {t('signin.useTestCode')}
                    </button>
                  </p>
                )}
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

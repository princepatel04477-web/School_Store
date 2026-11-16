import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, X } from '../ui/icons';
import { Input } from '../ui/Input';
import { ListenButton } from '../ListenButton';
import { useLang, type MessageKey } from '../../i18n';
import {
  FIT_LIMITS,
  GARMENT_CHEST_EASE_CM,
  checkMeasure,
  formatMeasure,
  garmentKind,
  parseMeasure,
  useMeasureConfig,
  useSizeFit,
  type Fit,
  type FitFieldError,
  type ProductFit,
} from '../../data/fit';
import { DEFAULT_SHOULDER_FACTOR, MEASURE_WITH_CAMERA } from '../../measure/config';
import type { GarmentMeasureResult, ReferenceKind } from '../../measure/flatGarment';
import { isSaneShoulder, withMassCurve, type MeasureResult, type SideResult } from '../../measure/measureBody';
import { InstructionDrawing, ShoulderDiagram } from './MeasureDrawings';
import { measureDebug } from '../../utils/measureDebug';
import './measureFlow.css';

// The camera steps (and MediaPipe) only download when the parent opens them.
const MeasureCapture = lazy(() =>
  import('../../measure/MeasureCapture').then((m) => ({ default: m.MeasureCapture }))
);
const GarmentCapture = lazy(() =>
  import('../../measure/GarmentCapture').then((m) => ({ default: m.GarmentCapture }))
);

/** "side" and "sideCamera" only run in test mode (measuredebug), to collect body depth. */
type Step = 'details' | 'instructions' | 'garmentCamera' | 'camera' | 'side' | 'sideCamera' | 'manual' | 'results';
type CameraMode = 'garment' | 'body';

export interface MeasureGarment {
  id: string;
  name: string;
}

export interface MeasureFlowProps {
  /** The child's current measurement: prefills the numbers. */
  initial?: Fit | null;
  /** Shirts and trousers on this list, to show the suggested sizes on the results screen. */
  garments?: MeasureGarment[];
  className?: string;
  /** Saves the measurement. Resolves false when only this phone kept it. */
  onSave: (fit: Fit) => Promise<boolean> | boolean;
  onClose: () => void;
}

const asText = (value?: number) => (value === undefined ? '' : String(value));

export function MeasureFlow({ initial, garments = [], className, onSave, onClose }: MeasureFlowProps) {
  const { t } = useLang();
  const [step, setStep] = useState<Step>('details');
  const [cameraMode, setCameraMode] = useState<CameraMode>('garment');
  const [referenceKind, setReferenceKind] = useState<ReferenceKind>('card');
  const [height, setHeight] = useState(asText(initial?.heightCm));
  const [weight, setWeight] = useState(asText(initial?.weightKg));
  const [shoulderText, setShoulderText] = useState(initial?.source === 'MANUAL' ? asText(initial?.shoulderCm) : '');
  const [errors, setErrors] = useState<{ height?: FitFieldError | null; weight?: FitFieldError | null; shoulder?: FitFieldError | null }>({});
  const [notice, setNotice] = useState<MessageKey | null>(null);
  // The measurement being checked on the results screen.
  const [draft, setDraft] = useState<Fit | null>(null);
  // The camera's raw readings, shown only for tape checks.
  const [raw, setRaw] = useState<MeasureResult | null>(null);
  const [garmentRaw, setGarmentRaw] = useState<GarmentMeasureResult | null>(null);
  const [side, setSide] = useState<SideResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const config = useMeasureConfig((step === 'instructions' && cameraMode === 'body') || step === 'camera');
  const factor = config.data?.shoulder_calibration_factor ?? DEFAULT_SHOULDER_FACTOR;

  // Escape closes, except while the camera owns the screen (it has its own Cancel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'camera' && step !== 'garmentCamera') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const rangeMessage = (field: 'height' | 'weight' | 'shoulder', error?: FitFieldError | null) => {
    if (!error) return undefined;
    if (error === 'required') return t('fit.err.required');
    if (error === 'notNumber') return t('fit.err.notNumber');
    const limit = FIT_LIMITS[field];
    const key: MessageKey =
      field === 'height' ? 'fit.err.heightRange' : field === 'weight' ? 'fit.err.weightRange' : 'mf.err.shoulderRange';
    return t(key, { min: limit.min, max: limit.max });
  };

  const submitDetails = (event: FormEvent) => {
    event.preventDefault();
    const next = { height: checkMeasure(height, FIT_LIMITS.height), weight: checkMeasure(weight, FIT_LIMITS.weight) };
    setErrors(next);
    if (next.height || next.weight) return;
    setNotice(null);
    setStep(MEASURE_WITH_CAMERA ? 'instructions' : 'manual');
  };

  const numbers = () => ({ heightCm: parseMeasure(height)!, weightKg: parseMeasure(weight)! });

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const shoulderError = shoulderText.trim() ? checkMeasure(shoulderText, FIT_LIMITS.shoulder) : null;
    setErrors({ shoulder: shoulderError });
    if (shoulderError) return;
    const shoulder = parseMeasure(shoulderText);
    setDraft({
      ...numbers(),
      ...(shoulder !== null ? { shoulderCm: shoulder } : {}),
      source: 'MANUAL',
      shoulderEdited: false,
    });
    setStep('results');
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveFailed(false);
    const measured = { ...draft, measuredAt: new Date().toISOString() };
    try {
      const saved = await onSave(measured);
      if (saved) onClose();
      else setSaveFailed(true);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const cameraSteps: Step[] = ['details', 'instructions', cameraMode === 'garment' ? 'garmentCamera' : 'camera'];
  const stepNumber = cameraSteps.indexOf(step) + 1;
  const back = () => {
    setNotice(null);
    if (step === 'instructions' || step === 'manual') setStep('details');
    else if (step === 'side') setStep('instructions');
    else if (step === 'results') setStep(draft?.source === 'CAMERA' ? 'instructions' : 'manual');
    else onClose();
  };

  if (step === 'garmentCamera') {
    return (
      <Suspense fallback={<div className="mflow" role="status"><p className="mflow-loading">{t('measure.loadingCamera')}</p></div>}>
        <GarmentCapture
          referenceKind={referenceKind}
          onReferenceChange={setReferenceKind}
          onResult={(result) => {
            const shoulderOut =
              result.shoulder_cm < FIT_LIMITS.shoulder.min || result.shoulder_cm > FIT_LIMITS.shoulder.max;
            const chestOut =
              result.chest_flat_cm < FIT_LIMITS.chestFlat.min || result.chest_flat_cm > FIT_LIMITS.chestFlat.max;
            const lengthOut =
              result.length_cm < FIT_LIMITS.length.min || result.length_cm > FIT_LIMITS.length.max;
            if (shoulderOut || chestOut || lengthOut) {
              setNotice('mf.retakeNeeded');
              setStep('instructions');
              return;
            }
            setGarmentRaw(result);
            setRaw(null);
            setSide(null);
            setDraft({
              ...numbers(),
              shoulderCm: result.shoulder_cm,
              chestFlatCm: result.chest_flat_cm,
              chestCm: Math.max(
                FIT_LIMITS.chest.min,
                Math.round((result.chest_around_cm - GARMENT_CHEST_EASE_CM) * 10) / 10,
              ),
              lengthCm: result.length_cm,
              shoulderConfidence: 0.99,
              source: 'CAMERA',
              shoulderEdited: false,
            });
            setStep('results');
          }}
          onCancel={() => setStep('instructions')}
        />
      </Suspense>
    );
  }

  if (step === 'camera') {
    return (
      <Suspense fallback={<div className="mflow" role="status"><p className="mflow-loading">{t('measure.loadingCamera')}</p></div>}>
        <MeasureCapture
          heightCm={parseMeasure(height)!}
          factor={factor}
          onResult={(result) => {
            const heightCm = parseMeasure(height)!;
            setRaw(result);
            setGarmentRaw(null);
            // The check is on the camera's own reading: it catches a bad photo.
            if (!result || !isSaneShoulder(result.shoulder_cm, heightCm)) {
              setNotice('mf.retakeNeeded');
              setStep('instructions');
              return;
            }
            setDraft({
              ...numbers(),
              shoulderCm: withMassCurve(result.shoulder_cm, heightCm, parseMeasure(weight)!),
              shoulderConfidence: result.confidence,
              source: 'CAMERA',
              shoulderEdited: false,
            });
            setSide(null);
            setStep(measureDebug() ? 'side' : 'results');
          }}
          onCancel={() => setStep('instructions')}
          onCameraError={() => {
            setNotice('mf.manual.cameraOff');
            setStep('manual');
          }}
        />
      </Suspense>
    );
  }

  if (step === 'sideCamera') {
    return (
      <Suspense fallback={<div className="mflow" role="status"><p className="mflow-loading">{t('measure.loadingCamera')}</p></div>}>
        <MeasureCapture
          heightCm={parseMeasure(height)!}
          factor={factor}
          view="side"
          onResult={() => undefined}
          onSideResult={(result) => {
            setSide(result);
            if (!result) {
              setNotice('mf.side.failed');
              setStep('side');
              return;
            }
            setStep('results');
          }}
          onCancel={() => setStep('side')}
          onCameraError={() => setStep('results')}
        />
      </Suspense>
    );
  }

  return (
    <div className="mflow" role="dialog" aria-modal="true" aria-labelledby="mflow-title">
      <header className="mflow-head">
        <button type="button" className="mflow-icon-btn" onClick={back} aria-label={t('mf.back')}>
          <ArrowLeft width={20} height={20} />
        </button>
        <div className="mflow-head-text">
          <h2 id="mflow-title">{t('mf.title')}</h2>
          {stepNumber > 0 && MEASURE_WITH_CAMERA && (
            <span className="mflow-step">{t('mf.step', { n: stepNumber, total: 3 })}</span>
          )}
        </div>
        <button type="button" className="mflow-icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <X width={20} height={20} />
        </button>
      </header>

      <div className="mflow-body">
        {notice && (
          <p className="mflow-notice" role="alert">
            {t(notice)}
          </p>
        )}

        {step === 'details' && (
          <form className="mflow-form" onSubmit={submitDetails} noValidate>
            <h3 className="mflow-title">{t('mf.details.title')}</h3>
            <p className="mflow-sub">{t('mf.details.sub')}</p>
            <Input
              id="mflow-height"
              label={t('fit.height')}
              hint={t('fit.heightHint')}
              error={rangeMessage('height', errors.height)}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              value={height}
              onChange={(e) => {
                setHeight(e.target.value);
                setErrors((prev) => ({ ...prev, height: checkMeasure(e.target.value, FIT_LIMITS.height) === 'range' ? 'range' : null }));
              }}
            />
            <Input
              id="mflow-weight"
              label={t('fit.weight')}
              hint={t('fit.weightHint')}
              error={rangeMessage('weight', errors.weight)}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                setErrors((prev) => ({ ...prev, weight: checkMeasure(e.target.value, FIT_LIMITS.weight) === 'range' ? 'range' : null }));
              }}
            />
            <div className="mflow-actions">
              <button type="submit" className="btn btn-primary">{t('mf.next')}</button>
            </div>
          </form>
        )}

        {step === 'instructions' && (
          <div className="mflow-form">
            <h3 className="mflow-title">{t('mf.ins.title')}</h3>
            <div className="mflow-modes" role="radiogroup" aria-label={t('mf.title')}>
              <button
                type="button"
                role="radio"
                aria-checked={cameraMode === 'garment'}
                className={`mflow-mode-btn ${cameraMode === 'garment' ? 'is-selected' : ''}`}
                onClick={() => setCameraMode('garment')}
              >
                <span className="mflow-mode-dot" aria-hidden="true" />
                <span className="mflow-mode-copy">
                  <b>{t('mf.mode.garment')}</b>
                  <small>{t('mf.mode.garmentSub')}</small>
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={cameraMode === 'body'}
                className={`mflow-mode-btn ${cameraMode === 'body' ? 'is-selected' : ''}`}
                onClick={() => setCameraMode('body')}
              >
                <span className="mflow-mode-dot" aria-hidden="true" />
                <span className="mflow-mode-copy">
                  <b>{t('mf.mode.body')}</b>
                  <small>{t('mf.mode.bodySub')}</small>
                </span>
              </button>
            </div>
            {cameraMode === 'garment' ? (
              <>
                <ListenButton
                  text={`${t('mf.ins.garmentFlat')} ${t('mf.ins.garmentCard')} ${t('mf.ins.garmentSnap')} ${t('measure.photoStays')}`}
                />
                <ol className="mflow-howto">
                  <li>
                    <InstructionDrawing kind="shirtFlat" />
                    <p>{t('mf.ins.garmentFlat')}</p>
                  </li>
                  <li>
                    <InstructionDrawing kind="shirtCard" />
                    <p>{t('mf.ins.garmentCard')}</p>
                  </li>
                  <li>
                    <InstructionDrawing kind="shirtSnap" />
                    <p>{t('mf.ins.garmentSnap')}</p>
                  </li>
                </ol>
              </>
            ) : (
              <>
                <ListenButton text={`${t('mf.ins.wall')} ${t('mf.ins.phone')} ${t('mf.ins.light')} ${t('measure.photoStays')}`} />
                <ol className="mflow-howto">
                  <li>
                    <InstructionDrawing kind="wall" />
                    <p>{t('mf.ins.wall')}</p>
                  </li>
                  <li>
                    <InstructionDrawing kind="phone" />
                    <p>{t('mf.ins.phone')}</p>
                  </li>
                  <li>
                    <InstructionDrawing kind="light" />
                    <p>{t('mf.ins.light')}</p>
                  </li>
                </ol>
              </>
            )}
            <p className="mflow-privacy">{t('measure.photoStays')}</p>
            <div className="mflow-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setNotice(null);
                  setStep(cameraMode === 'garment' ? 'garmentCamera' : 'camera');
                }}
              >
                {t(cameraMode === 'garment' ? 'mf.ins.openGarment' : 'mf.ins.open')}
              </button>
              <button type="button" className="mflow-link" onClick={() => { setNotice(null); setStep('manual'); }}>
                {t('mf.ins.type')}
              </button>
            </div>
          </div>
        )}

        {step === 'side' && (
          <div className="mflow-form">
            <h3 className="mflow-title">{t('mf.side.title')}</h3>
            <p className="mflow-sub">{t('mf.side.body')}</p>
            <div className="mflow-actions">
              <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setStep('sideCamera'); }}>
                {t('mf.ins.open')}
              </button>
              <button type="button" className="mflow-link" onClick={() => { setNotice(null); setStep('results'); }}>
                {t('mf.side.skip')}
              </button>
            </div>
          </div>
        )}

        {step === 'manual' && (
          <form className="mflow-form" onSubmit={submitManual} noValidate>
            <h3 className="mflow-title">{t('mf.manual.title')}</h3>
            <p className="mflow-sub">
              {t('mf.res.height')}: {t('mf.cm', { v: formatMeasure(parseMeasure(height)) })} · {t('mf.res.weight')}:{' '}
              {t('mf.kg', { v: formatMeasure(parseMeasure(weight)) })}
            </p>
            <ShoulderDiagram label={t('mf.manual.diagram')} />
            <Input
              id="mflow-shoulder"
              label={t('mf.manual.shoulder')}
              hint={t('mf.manual.shoulderHint')}
              error={rangeMessage('shoulder', errors.shoulder)}
              inputMode="decimal"
              autoComplete="off"
              value={shoulderText}
              onChange={(e) => {
                setShoulderText(e.target.value);
                setErrors({});
              }}
            />
            <div className="mflow-actions">
              <button type="submit" className="btn btn-primary">{t('mf.next')}</button>
            </div>
          </form>
        )}

        {step === 'results' && draft && (
          <Results
            draft={draft}
            garments={garments}
            className={className}
            onChange={setDraft}
            saving={saving}
            saveFailed={saveFailed}
            debugLine={
              measureDebug() && draft.source === 'CAMERA'
                ? garmentRaw
                  ? [
                      `Build ${__BUILD__}`,
                      `Flat cloth (${garmentRaw.reference.toUpperCase()})`,
                      `shoulder ${garmentRaw.shoulder_cm} cm`,
                      `chest flat ${garmentRaw.chest_flat_cm} cm (around ${garmentRaw.chest_around_cm} cm)`,
                      `length ${garmentRaw.length_cm} cm`,
                    ].join(', ')
                  : raw
                    ? [
                        `Build ${__BUILD__}`,
                        raw.corner_cm !== undefined ? `Shoulder points ${raw.corner_cm} cm` : 'Shoulder points not found',
                        raw.joint_cm !== undefined
                          ? `Joints ${raw.joint_cm} cm, outline ${raw.edge_cm} cm, camera ${raw.shoulder_cm} cm`
                          : `Joints only (no outline edges), camera ${raw.shoulder_cm} cm`,
                        `with weight ${withMassCurve(raw.shoulder_cm, draft.heightCm, draft.weightKg)} cm`,
                        side ? `side depth ${side.depth_cm} cm` : 'no side photo',
                      ].join(', ')
                    : undefined
                : undefined
            }
            onRetake={() =>
              setStep(
                draft.source === 'CAMERA'
                  ? garmentRaw || cameraMode === 'garment'
                    ? 'garmentCamera'
                    : 'camera'
                  : 'manual',
              )
            }
            onSave={() => void save()}
            onContinue={onClose}
          />
        )}
      </div>
    </div>
  );
}

/** Results (Prompt 23): every number can be changed; suggestions update as it changes. */
function Results({
  draft,
  garments,
  className,
  onChange,
  saving,
  saveFailed,
  debugLine,
  onRetake,
  onSave,
  onContinue,
}: {
  draft: Fit;
  debugLine?: string;
  garments: MeasureGarment[];
  className?: string;
  onChange: (fit: Fit) => void;
  saving: boolean;
  saveFailed: boolean;
  onRetake: () => void;
  onSave: () => void;
  onContinue: () => void;
}) {
  const { t } = useLang();
  // Suggestions are asked for a moment after the parent stops typing.
  const [settled, setSettled] = useState(draft);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(draft), 400);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const ids = useMemo(() => garments.map((g) => g.id), [garments]);
  const fits = useSizeFit(ids, settled, className, ids.length > 0);
  const suggestion = (id?: string) => {
    const productFit: ProductFit | undefined = id ? fits.data?.products[id] : undefined;
    const rec = productFit?.recommendation;
    if (!rec || !rec.size || rec.status === 'NO_CHART') return null;
    return rec.alt_size ? `${rec.size} / ${rec.alt_size}` : rec.size;
  };
  // The shirt and the trouser with a size chart; a shirt or trouser by name comes
  // before a blazer or skirt.
  const firstSuggested = (kind: 'top' | 'bottom', preferred: RegExp) => {
    const ofKind = garments.filter((g) => garmentKind(g.name) === kind);
    const ordered = [...ofKind.filter((g) => preferred.test(g.name)), ...ofKind.filter((g) => !preferred.test(g.name))];
    return ordered.map((g) => suggestion(g.id)).find(Boolean) ?? null;
  };
  const shirt = firstSuggested('top', /shirt/i);
  const trouser = firstSuggested('bottom', /trouser|pant/i);

  const shoulderNote: MessageKey =
    draft.source === 'CAMERA' ? (draft.shoulderEdited ? 'mf.res.changed' : 'mf.res.fromCamera') : 'mf.res.typed';

  return (
    <div className="mflow-form">
      <h3 className="mflow-title">{t('mf.res.title')}</h3>
      <p className="mflow-sub">{t('mf.res.sub')}</p>
      <dl className="mflow-values">
        <EditableValue
          label={t('mf.res.height')}
          unit="cm"
          value={draft.heightCm}
          limit={FIT_LIMITS.height}
          rangeKey="fit.err.heightRange"
          onCommit={(v) => v !== undefined && onChange({ ...draft, heightCm: v })}
        />
        <EditableValue
          label={t('mf.res.weight')}
          unit="kg"
          value={draft.weightKg}
          limit={FIT_LIMITS.weight}
          rangeKey="fit.err.weightRange"
          onCommit={(v) => v !== undefined && onChange({ ...draft, weightKg: v })}
        />
        <EditableValue
          label={t('mf.res.shoulder')}
          unit="cm"
          value={draft.shoulderCm}
          limit={FIT_LIMITS.shoulder}
          rangeKey="mf.err.shoulderRange"
          optional
          note={draft.shoulderCm !== undefined ? t(shoulderNote) : undefined}
          onCommit={(v) => {
            if (v === draft.shoulderCm) return;
            const next: Fit = { ...draft, shoulderCm: v };
            if (v === undefined) delete next.shoulderCm;
            // A changed camera reading is marked, so the tailor knows a person typed it.
            if (draft.source === 'CAMERA') next.shoulderEdited = true;
            onChange(next);
          }}
        />
        {draft.chestFlatCm !== undefined && (
          <EditableValue
            label={t('mf.res.chestFlat')}
            unit="cm"
            value={draft.chestFlatCm}
            limit={FIT_LIMITS.chestFlat}
            rangeKey="mf.err.chestFlatRange"
            optional
            note={t('mf.res.aroundNote', { v: formatMeasure(Math.round(draft.chestFlatCm * 2 * 10) / 10) })}
            onCommit={(v) => {
              if (v === draft.chestFlatCm) return;
              const next: Fit = { ...draft };
              if (v === undefined) {
                delete next.chestFlatCm;
                delete next.chestCm;
              } else {
                next.chestFlatCm = v;
                next.chestCm = Math.max(
                  FIT_LIMITS.chest.min,
                  Math.round((v * 2 - GARMENT_CHEST_EASE_CM) * 10) / 10,
                );
              }
              onChange(next);
            }}
          />
        )}
        {draft.lengthCm !== undefined && (
          <EditableValue
            label={t('mf.res.length')}
            unit="cm"
            value={draft.lengthCm}
            limit={FIT_LIMITS.length}
            rangeKey="mf.err.lengthRange"
            optional
            onCommit={(v) => {
              const next: Fit = { ...draft };
              if (v === undefined) delete next.lengthCm;
              else next.lengthCm = v;
              onChange(next);
            }}
          />
        )}
      </dl>
      {debugLine && <p className="mflow-sub">{debugLine}</p>}

      {shirt || trouser ? (
        <div className="mflow-suggest">
          {shirt && (
            <p>
              <span>{t('mf.res.shirt')}</span>
              <b>{shirt}</b>
            </p>
          )}
          {trouser && (
            <p>
              <span>{t('mf.res.trouser')}</span>
              <b>{trouser}</b>
            </p>
          )}
        </div>
      ) : (
        <p className="mflow-sub">{t('mf.res.noChart')}</p>
      )}

      {saveFailed && (
        <p className="mflow-notice" role="alert">
          {t('mf.res.saveError')}
        </p>
      )}
      <div className="mflow-actions">
        {saveFailed ? (
          <button type="button" className="btn btn-primary" onClick={onContinue}>
            {t('match.continue')}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
            {saving ? t('mf.res.saving') : t('mf.res.save')}
          </button>
        )}
        <button type="button" className="btn btn-outline" disabled={saving} onClick={onRetake}>
          {t('mf.res.retake')}
        </button>
      </div>
    </div>
  );
}

function EditableValue({
  label,
  unit,
  value,
  limit,
  rangeKey,
  optional,
  note,
  onCommit,
}: {
  label: string;
  unit: 'cm' | 'kg';
  value?: number;
  limit: { min: number; max: number };
  rangeKey: MessageKey;
  optional?: boolean;
  note?: string;
  onCommit: (value: number | undefined) => void;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<FitFieldError | null>(null);

  const shown =
    value === undefined
      ? t('mf.res.none')
      : t(unit === 'cm' ? 'mf.cm' : 'mf.kg', { v: formatMeasure(value) });

  const commit = () => {
    if (optional && !text.trim()) {
      onCommit(undefined);
      setEditing(false);
      return;
    }
    const problem = checkMeasure(text, limit);
    setError(problem);
    if (problem) return;
    onCommit(Math.round(parseMeasure(text)! * 10) / 10);
    setEditing(false);
  };

  return (
    <div className="mflow-value">
      <dt>{label}</dt>
      <dd>
        {editing ? (
          <span className="mflow-value-edit">
            <input
              autoFocus
              inputMode="decimal"
              aria-label={label}
              aria-invalid={Boolean(error)}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                }
              }}
            />
            <span>{unit}</span>
          </span>
        ) : (
          <button
            type="button"
            className="mflow-value-btn"
            onClick={() => {
              setText(value === undefined ? '' : String(value));
              setEditing(true);
            }}
          >
            {shown}
          </button>
        )}
        {error && (
          <small className="mflow-value-error" role="alert">
            {error === 'range'
              ? t(rangeKey, { min: limit.min, max: limit.max })
              : t(error === 'required' ? 'fit.err.required' : 'fit.err.notNumber')}
          </small>
        )}
        {note && !editing && <small className="mflow-value-note">{note}</small>}
      </dd>
    </div>
  );
}

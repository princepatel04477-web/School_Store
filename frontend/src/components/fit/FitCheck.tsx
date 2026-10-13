import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Input } from '../ui/Input';
import { Ruler } from '../ui/icons';
import { ListenButton } from '../ListenButton';
import { useLang, type MessageKey } from '../../i18n';
import { classLabel } from '../../i18n/labels';
import {
  FIT_LIMITS,
  checkMeasure,
  formatMeasure,
  parseMeasure,
  type Fit,
  type FitFieldError,
  type FitWarning,
} from '../../data/fit';
import { MEASURE_WITH_CAMERA } from '../../measure/config';
import './fit.css';

// The camera step (and MediaPipe) only loads when a parent opens it.
const MeasureCapture = lazy(() =>
  import('../../measure/MeasureCapture').then((m) => ({ default: m.MeasureCapture }))
);

const WARNING_KEYS: Record<FitWarning, MessageKey> = {
  HEIGHT_UNUSUAL_FOR_CLASS: 'fit.warn.height',
  WEIGHT_UNUSUAL_FOR_CLASS: 'fit.warn.weight',
  HEIGHT_WEIGHT_UNUSUAL: 'fit.warn.both',
};

/** Asks for the child's height and weight before any size is picked. */
export function FitCheck({
  initial,
  onSubmit,
  onSkip,
}: {
  initial?: Fit;
  onSubmit: (fit: Fit) => void;
  onSkip: () => void;
}) {
  const { t } = useLang();
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : '');
  const [weight, setWeight] = useState(initial ? String(initial.weightKg) : '');
  const [errors, setErrors] = useState<{ height?: FitFieldError | null; weight?: FitFieldError | null }>({});
  // Shoulder width from the optional camera step: two numbers, never the picture.
  const [shoulder, setShoulder] = useState<{ cm: number; confidence: number } | null>(
    initial?.shoulderCm !== undefined && initial.shoulderConfidence !== undefined
      ? { cm: initial.shoulderCm, confidence: initial.shoulderConfidence }
      : null
  );
  const [cameraOpen, setCameraOpen] = useState(false);
  const [needHeight, setNeedHeight] = useState(false);

  const openCamera = () => {
    if (checkMeasure(height, FIT_LIMITS.height)) {
      setNeedHeight(true);
      return;
    }
    setNeedHeight(false);
    setCameraOpen(true);
  };

  const message = (field: 'height' | 'weight', error?: FitFieldError | null) => {
    if (!error) return undefined;
    if (error === 'required') return t('fit.err.required');
    if (error === 'notNumber') return t('fit.err.notNumber');
    const limit = FIT_LIMITS[field];
    return t(field === 'height' ? 'fit.err.heightRange' : 'fit.err.weightRange', { min: limit.min, max: limit.max });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      height: checkMeasure(height, FIT_LIMITS.height),
      weight: checkMeasure(weight, FIT_LIMITS.weight),
    };
    setErrors(next);
    if (next.height || next.weight) return;
    onSubmit({
      heightCm: parseMeasure(height)!,
      weightKg: parseMeasure(weight)!,
      ...(shoulder ? { shoulderCm: shoulder.cm, shoulderConfidence: shoulder.confidence } : {}),
    });
  };

  return (
    <section className="fit-check" aria-labelledby="fit-check-title">
      <div className="fit-check-head">
        <Ruler width={22} height={22} strokeWidth={1.5} className="fit-check-icon" />
        <div>
          <h2 id="fit-check-title" className="fit-check-title">{t('fit.title')}</h2>
          <p className="fit-check-sub">{t('fit.sub')}</p>
        </div>
      </div>
      <ListenButton text={`${t('fit.title')}. ${t('fit.sub')} ${t('fit.heightHint')}.`} />

      <form className="fit-check-form" onSubmit={submit} noValidate>
        <div className="fit-check-fields">
          <Input
            id="fit-height"
            label={t('fit.height')}
            hint={t('fit.heightHint')}
            error={message('height', errors.height)}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            value={height}
            onChange={(e) => {
              setHeight(e.target.value);
              setErrors((prev) => ({ ...prev, height: null }));
              // The camera scales by the height, so a new height needs a new reading.
              setShoulder(null);
            }}
          />
          <Input
            id="fit-weight"
            label={t('fit.weight')}
            hint={t('fit.weightHint')}
            error={message('weight', errors.weight)}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            value={weight}
            onChange={(e) => {
              setWeight(e.target.value);
              setErrors((prev) => ({ ...prev, weight: null }));
            }}
          />
        </div>
        {MEASURE_WITH_CAMERA && (
          <div className="fit-camera">
            {shoulder ? (
              <p className="fit-camera-done">
                {t('fit.camera.done', { s: formatMeasure(shoulder.cm) })}{' '}
                <button type="button" className="fit-check-skip" onClick={() => setShoulder(null)}>
                  {t('fit.camera.remove')}
                </button>
              </p>
            ) : (
              <button type="button" className="btn btn-secondary fit-camera-open" onClick={openCamera}>
                {t('fit.camera.open')}
              </button>
            )}
            <p className="fit-check-privacy">{t('fit.camera.privacy')}</p>
            {needHeight && (
              <p className="fit-summary-warning" role="alert">
                {t('fit.camera.needHeight')}
              </p>
            )}
          </div>
        )}
        {cameraOpen && (
          <Suspense fallback={null}>
            <MeasureCapture
              heightCm={parseMeasure(height)!}
              onResult={(result) => {
                setShoulder({ cm: result.shoulder_cm, confidence: result.confidence });
                setCameraOpen(false);
              }}
              onSkip={() => setCameraOpen(false)}
            />
          </Suspense>
        )}
        <p className="fit-check-privacy">{t('fit.privacy')}</p>
        <div className="fit-check-actions">
          <button type="submit" className="btn btn-primary">
            {t('fit.suggest')}
          </button>
          <button type="button" className="fit-check-skip" onClick={onSkip}>
            {t('fit.skip')}
          </button>
        </div>
      </form>
    </section>
  );
}

/** One line above the items once the parent has answered, with a way to change it. */
export function FitSummary({
  answer,
  warnings,
  className,
  failed,
  onChange,
  onRetry,
}: {
  answer: Fit | 'skipped';
  warnings?: FitWarning[];
  className?: string;
  failed?: boolean;
  onChange: () => void;
  onRetry?: () => void;
}) {
  const { t } = useLang();
  const skipped = answer === 'skipped';
  return (
    <div className="fit-summary" role="status">
      <div className="fit-summary-row">
        <Ruler width={18} height={18} strokeWidth={1.5} className="fit-check-icon" />
        <span className="fit-summary-text">
          {skipped
            ? t('fit.skipped')
            : answer.shoulderCm !== undefined
            ? t('fit.summaryShoulder', {
                h: formatMeasure(answer.heightCm),
                w: formatMeasure(answer.weightKg),
                s: formatMeasure(answer.shoulderCm),
              })
            : t('fit.summary', { h: formatMeasure(answer.heightCm), w: formatMeasure(answer.weightKg) })}
        </span>
        <button type="button" className="fit-summary-change" onClick={onChange}>
          {skipped ? t('fit.add') : t('fit.change')}
        </button>
      </div>
      {!skipped &&
        warnings?.map((warning) => (
          <p key={warning} className="fit-summary-warning">
            {t(WARNING_KEYS[warning], { cls: classLabel(className, t) })}
          </p>
        ))}
      {failed && (
        <p className="fit-summary-warning">
          {t('fit.error')}{' '}
          {onRetry && (
            <button type="button" className="fit-summary-change" onClick={onRetry}>
              {t('common.tryAgain')}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Ruler } from '../ui/icons';
import { useLang } from '../../i18n';
import { formatMeasure, formatMeasuredOn, type Fit } from '../../data/fit';
import { MEASURE_WITH_CAMERA } from '../../measure/config';
import type { MeasureGarment } from './MeasureFlow';
import './measureFlow.css';

// The measuring screens load only when the parent taps the button.
const MeasureFlow = lazy(() => import('./MeasureFlow').then((m) => ({ default: m.MeasureFlow })));

const LOCALES = { en: 'en-IN', gu: 'gu-IN', hi: 'hi-IN' } as const;

/**
 * On a shirt or trouser's size page: the "Accurate size" button, or the
 * child's measurement (height, weight, shoulder, date) with "Measure again".
 * One measurement serves every shirt and trouser for the child.
 */
export function MeasurementPanel({
  measurement,
  garments,
  className,
  onSave,
}: {
  measurement: Fit | null;
  garments?: MeasureGarment[];
  className?: string;
  onSave: (fit: Fit) => Promise<boolean> | boolean;
}) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);

  const flow = open
    ? createPortal(
        <Suspense fallback={<div className="mflow" role="status" />}>
          <MeasureFlow
            initial={measurement}
            garments={garments}
            className={className}
            onSave={onSave}
            onClose={() => setOpen(false)}
          />
        </Suspense>,
        document.body,
      )
    : null;

  if (!measurement) {
    return (
      <div className="size-accurate">
        <button type="button" className="size-accurate-btn" onClick={() => setOpen(true)}>
          {MEASURE_WITH_CAMERA ? <Camera width={22} height={22} /> : <Ruler width={22} height={22} />}
          <span>{t('size.accurate')}</span>
        </button>
        <p className="size-accurate-sub">{t(MEASURE_WITH_CAMERA ? 'size.accurateSub' : 'size.accurateTyped')}</p>
        {flow}
      </div>
    );
  }

  const date = formatMeasuredOn(measurement.measuredAt, LOCALES[lang]);
  return (
    <div className="size-measure-card">
      <div className="size-measure-head">
        <b>{t('size.card.title')}</b>
        {date && <span>{t('size.card.on', { date })}</span>}
      </div>
      <dl className="size-measure-values">
        <div>
          <dt>{t('mf.res.height')}</dt>
          <dd>{t('mf.cm', { v: formatMeasure(measurement.heightCm) })}</dd>
        </div>
        <div>
          <dt>{t('mf.res.weight')}</dt>
          <dd>{t('mf.kg', { v: formatMeasure(measurement.weightKg) })}</dd>
        </div>
        <div>
          <dt>{t('mf.res.shoulder')}</dt>
          <dd>{measurement.shoulderCm !== undefined ? t('mf.cm', { v: formatMeasure(measurement.shoulderCm) }) : '-'}</dd>
        </div>
      </dl>
      <button type="button" className="size-measure-again" onClick={() => setOpen(true)}>
        {t('size.again')}
      </button>
      {flow}
    </div>
  );
}

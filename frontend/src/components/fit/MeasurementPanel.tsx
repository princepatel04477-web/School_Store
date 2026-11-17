import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Fit } from '../../data/fit';
import type { MeasureGarment } from './MeasureFlow';
import { SizeRecommendationCard } from './SizeRecommendationCard';
import './measureFlow.css';

// The measuring screens load only when the parent taps the button.
const MeasureFlow = lazy(() => import('./MeasureFlow').then((m) => ({ default: m.MeasureFlow })));

/**
 * On a shirt or trouser's size page: live height + weight inputs with debounced
 * shoulder & size recommendation, or the child's measurement with "Measure again".
 * One measurement serves every shirt and trouser for the child.
 */
export function MeasurementPanel({
  measurement,
  garments,
  className,
  schoolId,
  classId,
  gender,
  productId,
  onSelectSize,
  onSave,
}: {
  measurement: Fit | null;
  garments?: MeasureGarment[];
  className?: string;
  schoolId?: string;
  classId?: string;
  gender?: string | null;
  productId?: string;
  onSelectSize?: (size: string) => void;
  onSave: (fit: Fit) => Promise<boolean> | boolean;
}) {
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

  return (
    <>
      <SizeRecommendationCard
        measurement={measurement}
        productId={productId}
        schoolId={schoolId}
        classId={classId}
        className={className}
        gender={gender}
        onSelectSize={onSelectSize}
        onSave={onSave}
        onOpenMeasureFlow={() => setOpen(true)}
      />
      {flow}
    </>
  );
}


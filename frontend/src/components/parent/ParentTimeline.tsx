import { useLang } from '../../i18n';
import { fulfilmentLabel } from './orderLabels';

interface ParentTimelineProps {
  status: string;
}

const PROGRESS_STEPS = ['PLACED', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'DELIVERED'] as const;

export function ParentTimeline({ status }: ParentTimelineProps) {
  const { t } = useLang();
  const normalizedStatus = String(status || '').trim().toUpperCase();

  // Terminal states show a single final state instead of a progress bar
  if (['CANCELLED', 'RETURNED', 'REFUNDED'].includes(normalizedStatus)) {
    return (
      <div className="parent-timeline-terminal" role="status">
        <div className={`terminal-badge terminal-${normalizedStatus.toLowerCase()}`}>
          <span className="terminal-dot" />
          <span className="terminal-text">{fulfilmentLabel(normalizedStatus, t)}</span>
        </div>
      </div>
    );
  }

  // Map non-terminal / legacy statuses to canonical 5 steps
  let activeIndex = -1;
  switch (normalizedStatus) {
    case 'PENDING':
    case 'PLACED':
      activeIndex = 0;
      break;
    case 'PROCESSING':
    case 'CONFIRMED':
      activeIndex = 1;
      break;
    case 'PACKED':
      activeIndex = 2;
      break;
    case 'SHIPPED':
    case 'DISPATCHED':
      activeIndex = 3;
      break;
    case 'DELIVERED':
      activeIndex = 4;
      break;
    default:
      activeIndex = -1;
  }

  return (
    <div className="parent-timeline" role="list" aria-label="Order progress">
      {PROGRESS_STEPS.map((stepKey, idx) => {
        const isDone = activeIndex >= idx;
        const isCurrent = activeIndex === idx;

        return (
          <div
            key={stepKey}
            className={`parent-timeline-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}
            role="listitem"
          >
            <div className="step-marker" aria-hidden="true">
              {idx + 1}
            </div>
            <div className="step-content">
              <span className="step-title">{fulfilmentLabel(stepKey, t)}</span>
              {/* A delivered order is finished, not "in progress". */}
              {isCurrent && normalizedStatus !== 'DELIVERED' && (
                <span className="parent-step-badge">{t('parent.activeOrder')}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

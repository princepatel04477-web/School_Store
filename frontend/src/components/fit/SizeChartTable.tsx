import { useLang, type MessageKey } from '../../i18n';
import { formatMeasure, formatMeasuredOn, type ChartRow, type Recommendation } from '../../data/fit';
import { SizeChartSkeleton } from '../ui/Skeleton';
import './fit.css';

type Column = {
  key: MessageKey;
  min: keyof ChartRow;
  max?: keyof ChartRow;
};

const COLUMNS: Column[] = [
  { key: 'fit.chart.height', min: 'height_cm_min', max: 'height_cm_max' },
  { key: 'fit.chart.weight', min: 'weight_kg_min', max: 'weight_kg_max' },
  { key: 'fit.chart.chest', min: 'chest_cm_min', max: 'chest_cm_max' },
  { key: 'fit.chart.shoulder', min: 'shoulder_cm_min', max: 'shoulder_cm_max' },
  { key: 'fit.chart.length', min: 'length_cm' },
];

function cell(row: ChartRow, column: Column): string {
  const low = row[column.min] as number | null;
  if (!column.max) return formatMeasure(low);
  const high = row[column.max] as number | null;
  if (low === null && high === null) return '-';
  if (low === null || high === null || low === high) return formatMeasure(low ?? high);
  return `${formatMeasure(low)}–${formatMeasure(high)}`;
}

/** The product's own chart in cm and kg, with the suggested and selected sizes marked. */
export function SizeChartTable({
  rows,
  loading,
  recommendation,
  selectedSize,
}: {
  rows?: ChartRow[];
  loading?: boolean;
  recommendation?: Recommendation | null;
  selectedSize?: string;
}) {
  const { t } = useLang();
  if (loading) return <SizeChartSkeleton label={t('fit.chart.loading')} />;
  if (!rows || rows.length === 0) return null;

  // Only the columns the school filled in.
  const columns = COLUMNS.filter((column) =>
    rows.some((row) => row[column.min] !== null || (column.max && row[column.max] !== null))
  );
  const marked = new Set([recommendation?.size, recommendation?.alt_size].filter(Boolean));

  return (
    <div className="size-chart">
      <h3 className="size-chart-title">{t('fit.chart.title')}</h3>
      <div className="size-chart-scroll">
        <table className="size-chart-table">
          <thead>
            <tr>
              <th scope="col">{t('fit.chart.size')}</th>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {t(column.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSuggested = marked.has(row.size);
              const isSelected = selectedSize === row.size;
              const rowClass = [
                isSuggested ? 'is-suggested' : '',
                isSelected ? 'is-selected-row' : '',
              ].filter(Boolean).join(' ') || undefined;

              return (
                <tr key={row.variant_id} className={rowClass}>
                  <th scope="row">
                    {row.size}
                    {isSuggested && <span className="visually-hidden"> ({t('fit.suggestedTag')})</span>}
                    {isSelected && <span className="visually-hidden"> ({t('product.size')})</span>}
                  </th>
                  {columns.map((column) => (
                    <td key={column.key}>{cell(row, column)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LOCALES = { en: 'en-IN', gu: 'gu-IN', hi: 'hi-IN' } as const;

/**
 * Transparent sizing explanation: shows why a size was recommended,
 * inputs used, measurement date, relevant garment specifications,
 * and clearly separates the recommendation from the parent's actual selection.
 */
export function RecommendationNote({
  recommendation,
  selectedSize,
  measuredAt,
  chartRows,
  sizes,
}: {
  recommendation?: Recommendation | null;
  selectedSize?: string;
  measuredAt?: string;
  chartRows?: ChartRow[];
  sizes?: { id: string; size: string; inStock: boolean }[];
}) {
  const { t, lang } = useLang();

  if (!recommendation || !recommendation.size) {
    if (recommendation && recommendation.status === 'NO_CHART') {
      return (
        <div className="fit-rec-box fit-rec-neutral">
          <p className="fit-rec-note-text">{t('fit.rec.noChart')}</p>
        </div>
      );
    }
    return null;
  }

  const { status, size, alt_size: alt, reason, inputs_used } = recommendation;
  const isSelected = Boolean(selectedSize);
  const selectionMatches = selectedSize === size;
  const targetRow = chartRows?.find((r) => r.size === size);

  // Date formatting
  const dateStr = formatMeasuredOn(measuredAt, LOCALES[lang]);
  const dateInfo = dateStr ? ` (${dateStr})` : '';

  // Reason text
  let statusText = '';
  if (status === 'FIT') {
    if (reason === 'SHOULDER_REFINED_EXACT' && inputs_used?.shoulder_cm) {
      statusText = t('fit.rec.shoulderRefined', {
        size,
        shoulder: formatMeasure(inputs_used.shoulder_cm),
      });
    } else if (reason === 'WEIGHT_ADJUSTED_NEXT_SIZE' && inputs_used?.weight_kg) {
      statusText = t('fit.rec.weightAdjusted', {
        size,
        weight: formatMeasure(inputs_used.weight_kg),
      });
    } else if (inputs_used?.height_cm && inputs_used?.weight_kg) {
      statusText = t('fit.rec.whySuggested', {
        height: formatMeasure(inputs_used.height_cm),
        weight: formatMeasure(inputs_used.weight_kg),
        dateInfo,
      });
    } else if (inputs_used?.height_cm) {
      statusText = t('fit.rec.whyHeightOnly', {
        height: formatMeasure(inputs_used.height_cm),
        dateInfo,
      });
    } else {
      statusText = t('fit.rec.fit', { size });
    }
  } else if (status === 'BETWEEN') {
    statusText = t('fit.rec.between', { small: alt, big: size });
  } else if (status === 'BELOW_CHART') {
    statusText = t('fit.rec.below', { size });
  } else if (status === 'ABOVE_CHART') {
    statusText = t('fit.rec.above', { size });
  }

  // Garment measurements from chart row
  const chestVal = targetRow?.chest_cm_min ?? null;
  const lengthVal = targetRow?.length_cm ?? null;
  const hasGarmentSpecs = chestVal !== null || lengthVal !== null;

  // City stock check for recommended size
  const recSizeObj = sizes?.find((s) => s.size === size);
  const isOutOfStock = recSizeObj ? !recSizeObj.inStock : false;

  return (
    <div className="fit-rec-box" role="region" aria-label={t('fit.suggestedTag')}>
      <div className="fit-rec-header">
        <span className="fit-rec-badge">
          {t('fit.suggestedTag')}: <strong>{size}</strong>
        </span>
        {isSelected && (
          <span className={`fit-select-badge ${selectionMatches ? 'is-match' : 'is-custom'}`}>
            {t('product.size')}: <strong>{selectedSize}</strong>
          </span>
        )}
      </div>

      {statusText && <p className="fit-rec-note-text">{statusText}</p>}

      {hasGarmentSpecs && (
        <p className="fit-rec-garment-specs">
          {t('fit.rec.garmentSpecs', {
            size,
            chest: chestVal !== null ? formatMeasure(chestVal) : '-',
            length: lengthVal !== null ? formatMeasure(lengthVal) : '-',
          })}
        </p>
      )}

      {isOutOfStock && (
        <p className="fit-rec-stock-warn">
          {t('fit.rec.outOfStock', { size })}
        </p>
      )}

      {isSelected && !selectionMatches && (
        <p className="fit-rec-diff-note">
          {t('fit.rec.selectionDiffers', { selected: selectedSize || '', recommended: size })}
        </p>
      )}

      {isSelected && selectionMatches && (
        <p className="fit-rec-match-note">
          {t('fit.rec.matchesRecommendation', { size: selectedSize || size })}
        </p>
      )}
    </div>
  );
}

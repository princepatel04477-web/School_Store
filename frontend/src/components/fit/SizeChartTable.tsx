import { useLang, type MessageKey } from '../../i18n';
import { formatMeasure, type ChartRow, type Recommendation } from '../../data/fit';
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

/** The product's own chart in cm and kg, with the suggested sizes marked. */
export function SizeChartTable({
  rows,
  loading,
  recommendation,
}: {
  rows?: ChartRow[];
  loading?: boolean;
  recommendation?: Recommendation | null;
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
              const isMarked = marked.has(row.size);
              return (
                <tr key={row.variant_id} className={isMarked ? 'is-suggested' : undefined}>
                  <th scope="row">
                    {row.size}
                    {isMarked && <span className="visually-hidden"> ({t('fit.suggestedTag')})</span>}
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

/** The suggestion in words: one size, two sizes, or outside the chart. */
export function RecommendationNote({ recommendation }: { recommendation?: Recommendation | null }) {
  const { t } = useLang();
  if (!recommendation || !recommendation.size) return null;
  const { status, size, alt_size: alt } = recommendation;
  let text = '';
  if (status === 'FIT') text = t('fit.rec.fit', { size });
  else if (status === 'BETWEEN') text = t('fit.rec.between', { small: alt, big: size });
  else if (status === 'BELOW_CHART') text = t('fit.rec.below', { size });
  else if (status === 'ABOVE_CHART') text = t('fit.rec.above', { size });
  if (!text) return null;
  return <p className="fit-rec-note">{text}</p>;
}

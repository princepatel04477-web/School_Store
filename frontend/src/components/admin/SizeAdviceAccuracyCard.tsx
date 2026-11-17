import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../../api';

interface AccuracyBucket {
  total: number;
  fits_well: number;
  fits_well_pct: number;
}

interface FlaggedChart {
  school_name: string;
  student_class: string;
  gender: string;
  product_name: string;
  chart_key: string;
  total_answers: number;
  too_tight_count: number;
  too_tight_pct: number;
  flag: string;
}

export interface SizeAccuracyReport {
  answers_this_season: number;
  fits_well_total: number;
  fits_well_pct: number;
  by_source: {
    estimate: AccuracyBucket;
    camera: AccuracyBucket;
    tape: AccuracyBucket;
  };
  by_confidence: {
    high: AccuracyBucket;
    medium: AccuracyBucket;
    low: AccuracyBucket;
  };
  flagged_charts: FlaggedChart[];
}

export function SizeAdviceAccuracyCard() {
  const { data, isLoading, error } = useQuery<SizeAccuracyReport>({
    queryKey: ['panel-size-accuracy'],
    queryFn: () => api<SizeAccuracyReport>('/panel/size-accuracy/'),
  });

  if (isLoading) {
    return <div className="card" style={{ padding: '16px' }}>Loading size accuracy report…</div>;
  }

  if (error || !data) {
    return (
      <div className="card" style={{ padding: '16px', color: '#b91c1c' }}>
        Failed to load size accuracy data.
      </div>
    );
  }

  const sourceChartData = [
    {
      source: 'Estimate',
      'Fits Well %': data.by_source?.estimate?.fits_well_pct || 0,
      total: data.by_source?.estimate?.total || 0,
    },
    {
      source: 'Camera',
      'Fits Well %': data.by_source?.camera?.fits_well_pct || 0,
      total: data.by_source?.camera?.total || 0,
    },
    {
      source: 'Tape',
      'Fits Well %': data.by_source?.tape?.fits_well_pct || 0,
      total: data.by_source?.tape?.total || 0,
    },
  ];

  const confidenceChartData = [
    {
      confidence: 'High',
      'Fits Well %': data.by_confidence?.high?.fits_well_pct || 0,
      total: data.by_confidence?.high?.total || 0,
    },
    {
      confidence: 'Medium',
      'Fits Well %': data.by_confidence?.medium?.fits_well_pct || 0,
      total: data.by_confidence?.medium?.total || 0,
    },
    {
      confidence: 'Low',
      'Fits Well %': data.by_confidence?.low?.fits_well_pct || 0,
      total: data.by_confidence?.low?.total || 0,
    },
  ];

  return (
    <div
      className="card size-advice-accuracy-card"
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#111827' }}>
            Size Advice Accuracy
          </h2>
          <small style={{ color: '#6b7280' }}>
            Continuous learning feedback from parent answers and exchange logs
          </small>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#2e8b57' }}>
            {data.fits_well_pct}%
          </div>
          <small style={{ color: '#6b7280' }}>
            {data.fits_well_total} of {data.answers_this_season} fits well
          </small>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
        <div style={{ border: '1px solid #f3f4f6', borderRadius: '6px', padding: '12px' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#374151' }}>Accuracy by Source</h4>
          <div style={{ height: '180px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="source" tick={{ fontSize: 12, fill: '#4b5563' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#4b5563' }} />
                <Tooltip formatter={(value: any) => [`${value}%`, 'Fits Well']} />
                <Bar dataKey="Fits Well %" fill="#2e8b57" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ border: '1px solid #f3f4f6', borderRadius: '6px', padding: '12px' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#374151' }}>Accuracy by Confidence</h4>
          <div style={{ height: '180px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={confidenceChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="confidence" tick={{ fontSize: 12, fill: '#4b5563' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#4b5563' }} />
                <Tooltip formatter={(value: any) => [`${value}%`, 'Fits Well']} />
                <Bar dataKey="Fits Well %" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {data.flagged_charts && data.flagged_charts.length > 0 ? (
        <div
          className="flagged-charts-alert"
          style={{
            backgroundColor: '#fffbeb',
            border: '1px solid #fef3c7',
            borderLeft: '4px solid #d97706',
            borderRadius: '6px',
            padding: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#92400e', fontWeight: 600, marginBottom: '8px' }}>
            <span>⚠️</span>
            <span>Flagged Size Charts ({data.flagged_charts.length})</span>
          </div>
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#78350f' }}>
            Over 15% of feedback answers for these charts reported "Too tight". Human review recommended:
          </p>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#78350f' }}>
            {data.flagged_charts.map((chart, idx) => (
              <li key={idx} style={{ marginBottom: '4px' }}>
                <strong>{chart.chart_key}</strong>:{' '}
                <span style={{ color: '#b45309', fontWeight: 600 }}>
                  {chart.too_tight_pct}% reported too tight
                </span>{' '}
                ({chart.too_tight_count} of {chart.total_answers} answers) —{' '}
                <em>{chart.flag}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #dcfce7',
            borderRadius: '6px',
            padding: '12px',
            fontSize: '13px',
            color: '#166534',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>✓</span>
          <span>All size charts operating within acceptable fit bounds (no charts over 15% too-tight feedback).</span>
        </div>
      )}
    </div>
  );
}

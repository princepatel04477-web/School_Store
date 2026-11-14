// Size check for the showcase store: the same rules as backend/catalog/sizing.py, in JavaScript.
// The showcase catalogue has no uploaded charts, so shirts, blazers, trousers and skirts use the
// sample chart from seed_data.py, matched by the number at the start of the size label
// ("28 (Class 1-3)" is size 28). Other items (S/M/L, shoes, socks) have no chart.
import LIMITS from '../../shared/fit_limits.json';

// size -> [height min, height max, weight min, weight max, shoulder min, shoulder max]
const TOP_CHART = {
  26: [110, 121, 16, 24, 26.0, 28.5],
  28: [120, 131, 20, 29, 28.0, 30.5],
  30: [130, 141, 25, 35, 30.0, 32.5],
  32: [140, 151, 30, 42, 32.0, 35.0],
  34: [150, 161, 36, 50, 34.5, 37.5],
  36: [160, 175, 42, 62, 37.0, 41.0],
};
// Waist sizes go by height and weight only.
const BOTTOM_CHART = {
  22: [110, 121, 16, 24],
  24: [120, 131, 20, 29],
  26: [130, 141, 25, 35],
  28: [140, 151, 30, 42],
  30: [150, 161, 36, 50],
  32: [160, 175, 42, 62],
};
const TOP_WORDS = /shirt|blouse|blazer|sweater|cardigan|jacket/i;
const BOTTOM_WORDS = /trouser|pant|skirt|shorts|chino/i;

// A typed shoulder width (tape measure) counts; a camera reading counts when the phone was sure.
export const SHOULDER_MIN_CONFIDENCE = 0.6;

/** Chart rows for one product, smallest first; empty when the item is not sized by measurement. */
export function chartFor(product) {
  if (product.category !== 'Uniform' || /\bset\b/i.test(product.name)) return [];
  const chart = BOTTOM_WORDS.test(product.name) ? BOTTOM_CHART : TOP_WORDS.test(product.name) ? TOP_CHART : null;
  if (!chart) return [];
  const rows = [];
  for (const variant of product.variants) {
    const values = chart[Number.parseInt(variant.size, 10)];
    if (!values) continue;
    const [hMin, hMax, wMin, wMax, sMin = null, sMax = null] = values;
    rows.push({
      variant_id: variant.id,
      size: variant.size,
      height_cm_min: hMin,
      height_cm_max: hMax,
      weight_kg_min: wMin,
      weight_kg_max: wMax,
      shoulder_cm_min: sMin,
      shoulder_cm_max: sMax,
      chest_cm_min: null,
      chest_cm_max: null,
      length_cm: null,
    });
  }
  return rows.sort((a, b) => a.height_cm_min - b.height_cm_min || a.height_cm_max - b.height_cm_max);
}

const number = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};
const oneDecimal = (n) => Math.round(n * 10) / 10;

/** Checks the numbers like validate_fit; returns { errors } or { fit }. */
export function checkFit(body) {
  const errors = {};
  const field = (name, limit) => {
    const value = number(body[name]);
    if (value === null) errors[name] = ['REQUIRED'];
    else if (Number.isNaN(value)) errors[name] = ['NOT_A_NUMBER'];
    else if (value < limit.min || value > limit.max) errors[name] = ['OUT_OF_RANGE'];
    return value;
  };
  const height = field('height_cm', LIMITS.height_cm);
  const weight = field('weight_kg', LIMITS.weight_kg);
  let shoulder = null;
  let confidence = null;
  if (number(body.shoulder_cm) !== null || number(body.shoulder_confidence) !== null) {
    shoulder = field('shoulder_cm', LIMITS.shoulder_cm);
    confidence = number(body.shoulder_confidence);
    if (Number.isNaN(confidence) || (confidence !== null && (confidence < 0 || confidence > 1))) {
      errors.shoulder_confidence = ['OUT_OF_RANGE'];
    }
  }
  if (Object.keys(errors).length) return { errors };
  return {
    fit: {
      height_cm: oneDecimal(height),
      weight_kg: oneDecimal(weight),
      shoulder_cm: shoulder === null ? null : oneDecimal(shoulder),
      shoulder_confidence: confidence,
    },
  };
}

const heavierThan = (row, weight) => weight !== null && row.weight_kg_max !== null && weight > row.weight_kg_max;
const rec = (status, size = '', alt_size = '') => ({ status, size, alt_size });
const biggerFirst = (rows, a, b) => {
  const [smaller, bigger] = rows.indexOf(a) < rows.indexOf(b) ? [a, b] : [b, a];
  return rec('BETWEEN', bigger.size, smaller.size);
};

/** Height first, then weight; `rows` sorted smallest first (see chartFor). */
export function recommendSize(rows, height, weight = null) {
  if (!rows.length) return rec('NO_CHART');
  const byHeight = rows.filter((r) => r.height_cm_min <= height && height <= r.height_cm_max);
  if (!byHeight.length) {
    if (height < rows[0].height_cm_min) return rec('BELOW_CHART', rows[0].size);
    if (height > Math.max(...rows.map((r) => r.height_cm_max))) return rec('ABOVE_CHART', rows[rows.length - 1].size);
    const below = rows.filter((r) => r.height_cm_max < height).at(-1);
    const above = rows.find((r) => r.height_cm_min > height);
    if (heavierThan(above, weight)) {
      const next = rows[rows.indexOf(above) + 1];
      return next ? biggerFirst(rows, above, next) : rec('ABOVE_CHART', above.size);
    }
    return biggerFirst(rows, below, above);
  }
  const fits = byHeight.filter((r) => !heavierThan(r, weight));
  if (!fits.length) {
    const biggest = byHeight.reduce((a, b) => (rows.indexOf(b) > rows.indexOf(a) ? b : a));
    const next = rows[rows.indexOf(biggest) + 1];
    return next ? biggerFirst(rows, biggest, next) : rec('ABOVE_CHART', biggest.size);
  }
  if (fits.length === 1) return rec('FIT', fits[0].size);
  const distance = (r) => Math.abs((r.height_cm_min + r.height_cm_max) / 2 - height);
  const [a, b] = [...fits].sort((x, y) => distance(x) - distance(y) || rows.indexOf(x) - rows.indexOf(y));
  return biggerFirst(rows, a, b);
}

/** Narrows a suggestion with the shoulder width, like refine_with_shoulder. */
export function refineWithShoulder(rows, result, shoulder) {
  if (result.status !== 'FIT' && result.status !== 'BETWEEN') return result;
  const bySize = Object.fromEntries(rows.map((r) => [r.size, r]));
  const fits = (r) =>
    r.shoulder_cm_min === null || r.shoulder_cm_max === null
      ? null
      : r.shoulder_cm_min <= shoulder && shoulder <= r.shoulder_cm_max;
  if (result.status === 'BETWEEN') {
    const bigger = bySize[result.size];
    const smaller = bySize[result.alt_size];
    if (!bigger || !smaller) return result;
    if (fits(bigger) === true && fits(smaller) === false) return rec('FIT', bigger.size);
    if (fits(smaller) === true && fits(bigger) === false) return rec('FIT', smaller.size);
    return result;
  }
  const row = bySize[result.size];
  if (!row || row.shoulder_cm_max === null || shoulder <= row.shoulder_cm_max) return result;
  const next = rows[rows.indexOf(row) + 1];
  return next ? rec('BETWEEN', next.size, row.size) : result;
}

export function suggest(rows, fit) {
  const result = recommendSize(rows, fit.height_cm, fit.weight_kg);
  const sure = fit.shoulder_confidence === null || fit.shoulder_confidence >= SHOULDER_MIN_CONFIDENCE;
  return fit.shoulder_cm !== null && sure ? refineWithShoulder(rows, result, fit.shoulder_cm) : result;
}

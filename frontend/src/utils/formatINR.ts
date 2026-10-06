/**
 * Format integer paise into Indian Rupee currency string without fractional paise.
 * e.g. 65000 paise -> "₹650"
 */
export function formatINR(paise: number): string {
  const rupees = Math.round(paise / 100);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

/**
 * Format whole rupees into Indian Rupee currency string.
 * e.g. 650 -> "₹650"
 */
export function formatRupees(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

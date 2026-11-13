const THOUSAND = 1_000;
const MILLION = 1_000_000;
const ONE_DECIMAL_BELOW = 10;

function scaled(value: number, unit: number, suffix: string): string {
  const v = value / unit;
  // One decimal below 10 units (1.2k, 1.4M), whole numbers above (15k). Truncate so 9999 never shows "10.0k".
  const text = v < ONE_DECIMAL_BELOW ? (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, '') : String(Math.floor(v));
  return `${text}${suffix}`;
}

/** Compact count for chips and badges: 980, 1.2k, 2k, 15k, 1.4M. Non-finite or negative input reads as 0. */
export function compactCount(n: number): string {
  const value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (value < THOUSAND) return String(value);
  if (value < MILLION) return scaled(value, THOUSAND, 'k');
  return scaled(value, MILLION, 'M');
}

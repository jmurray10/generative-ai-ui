const CURRENCY = new Set(['$', '€', '£', '¥', '₩', '₹']);

export function formatNumber(value: number, decimals?: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const opts: Intl.NumberFormatOptions =
    typeof decimals === 'number'
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('en-US', opts).format(n);
}

/**
 * Currency symbols typed into `suffix` ("427.5$") render as a prefix ("$427.50").
 * Other suffixes ("x", "USD", "%") stay after the number.
 */
export function formatReadout(value: number, prefix = '', suffix = '', decimals?: number): string {
  let pre = prefix;
  let suf = suffix;
  const symbol = suf.trim();
  if (!pre && CURRENCY.has(symbol)) {
    pre = symbol;
    suf = '';
  }
  const money = CURRENCY.has(pre.trim());
  const digits = decimals ?? (money ? 2 : undefined);
  return `${pre}${formatNumber(value, digits)}${suf}`;
}

/** Needle position is pegged to the scale. The readout is the real value. */
export function gaugePresentation(value: number, min = 0, max = 100, prefix = '', suffix = ''): { text: string; fraction: number; outside: boolean } {
  const v = Number.isFinite(value) ? value : 0;
  const lo = Number(min);
  const hi = Number(max);
  const span = hi - lo || 1;
  const fraction = Math.max(0, Math.min(1, (v - lo) / span));
  return {
    text: formatReadout(v, prefix, suffix),
    fraction,
    outside: v < lo || v > hi,
  };
}

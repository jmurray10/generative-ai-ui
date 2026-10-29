/** Typed slider values keep the number the person entered. The track grows to include it. */

export interface SliderBounds {
  min: number;
  max: number;
  widened: boolean;
}

export function sliderBounds(modelMin: number, modelMax: number, value: number): SliderBounds {
  const min = Math.min(modelMin, value);
  const max = Math.max(modelMax, value);
  return { min, max, widened: min < modelMin || max > modelMax };
}

/** '' and '-' are in-progress typing, not numbers. A finished '-5000' is negative. */
export function parseTypedNumber(raw: string): { partial: true } | { partial: false; value: number } {
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.' || raw.endsWith('.')) return { partial: true };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { partial: true };
  return { partial: false, value };
}

/** True when `value` already sits on a step tick, so a range input will not rewrite it. */
export function isStepAligned(value: number, min: number, step: number): boolean {
  if (!Number.isFinite(step) || step === 0) return true;
  const ticks = (value - min) / step;
  return Math.abs(ticks - Math.round(ticks)) < 1e-8;
}

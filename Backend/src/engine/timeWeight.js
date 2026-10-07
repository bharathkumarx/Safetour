import { SIGMA_TIME_HOURS } from '../config/constants.js';

/** Return the shortest circular distance between two clock hours. */
export function circularHourDistance(hourA, hourB) {
  const a = ((Number(hourA) % 24) + 24) % 24;
  const b = ((Number(hourB) % 24) + 24) % 24;
  return Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
}

/** Calculate a circular Gaussian time weight in the range (0, 1]. */
export function timeWeight(queryHour, incidentHour, sigma = SIGMA_TIME_HOURS) {
  if (!Number.isFinite(sigma) || sigma <= 0) return 0;
  const distance = circularHourDistance(queryHour, incidentHour);
  return Math.exp(-0.5 * (distance / sigma) ** 2);
}

export const circularGaussianWeight = timeWeight;

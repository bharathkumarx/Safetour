import { ENVIRONMENT_WEIGHTS } from '../config/constants.js';

const average = (rows, key, fallback) => {
  const values = rows.map((r) => Number(r[key] ?? r[`${key}_score`])).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
};

/** Return environment vulnerability, 0 meaning least vulnerable and 1 most. */
export function environmentVulnerability(incidents = [], { isNight = false, cityAverages = {} } = {}) {
  const lighting = average(incidents, 'lighting', cityAverages.lighting ?? 0.5);
  const cctv = average(incidents, 'cctv', cityAverages.cctv ?? 0.5);
  const police = average(incidents, 'police', cityAverages.police ?? 0.5);
  const crowd = average(incidents, 'crowd', cityAverages.crowd ?? 0.5);
  const weights = { ...ENVIRONMENT_WEIGHTS, lighting: ENVIRONMENT_WEIGHTS.lighting * (isNight ? 1.4 : 0.6) };
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const crowdProtective = incidents.some((i) => ['Pickpocketing', 'Chain Snatching'].includes(i.crimeType ?? i.crime_type));
  const crowdEffect = crowdProtective ? 1 - crowd : crowd;
  const protection = (weights.lighting * lighting + weights.cctv * cctv + weights.police * police + weights.crowd * crowdEffect) / sum;
  return Math.max(0, Math.min(1, 1 - protection));
}

export const environmentRisk = environmentVulnerability;
export const calculateEnvironmentVulnerability = environmentVulnerability;

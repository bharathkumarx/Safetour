import {
  BAYESIAN_SHRINKAGE_K,
  CRIME_RISK_WEIGHT,
  ENVIRONMENT_RISK_WEIGHT,
  EXCLUDED_CRIME_TYPES,
  SAFETY_LABELS,
} from '../config/constants.js';
import { createSpatialIndex, nearby } from './spatialIndex.js';
import { kdeAtPoint, logKde, percentileRank } from './kde.js';
import { environmentVulnerability } from './environment.js';

const usable = (i) => i.excluded !== true && !EXCLUDED_CRIME_TYPES.includes(i.crimeType ?? i.crime_type);
const labelFor = (score) => SAFETY_LABELS.find((x) => score >= x.min && score <= x.max)?.label ?? 'High Caution';
/** Combine normalized crime and environment risk components. */
export const calculateRisk = (crime, environment) =>
  Math.max(0, Math.min(1, CRIME_RISK_WEIGHT * crime + ENVIRONMENT_RISK_WEIGHT * environment));
/** Convert normalized risk to the public 0-100 SafeScore. */
export const calculateSafeScore = (risk) => Math.max(0, Math.min(100, Math.round(100 * (1 - risk))));
const mean = (rows, key, fallback = 0.5) => {
  const values = rows.map((r) => Number(r[key] ?? r[`${key}_score`])).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
};

export function calculateCityAverages(incidents = []) {
  return {
    lighting: mean(incidents, 'lighting'),
    cctv: mean(incidents, 'cctv'),
    police: mean(incidents, 'police'),
    crowd: mean(incidents, 'crowd'),
  };
}

/** Score a latitude/longitude and return the complete explainable result. */
export function scorePoint({
  lat,
  lng,
  hour = 12,
  incidents = [],
  eligibleIncidents,
  index = createSpatialIndex(incidents),
  allCellCrime = [0],
  allCellCrimeSorted = false,
  cityMeanCrime = 0,
  cityMeanEnvironment,
  cityAverages,
  isNight = hour >= 20 || hour < 5,
  radiusMeters = 900,
} = {}) {
  const eligible = eligibleIncidents ?? incidents.filter(usable);
  const local = nearby(index, lat, lng, radiusMeters).filter(usable);
  const cityEnv = cityMeanEnvironment ?? environmentVulnerability(eligible);
  const kde = kdeAtPoint({ lat, lng, incidents: eligible, index, queryHour: hour });
  const crimeRaw = logKde(kde.value);
  // Offline tables normally provide the distribution. For ad-hoc points,
  // retain a monotonic bounded signal rather than making every point rank 0.
  const crimePercentile = allCellCrime.length > 1
    ? percentileRank(crimeRaw, allCellCrime, { sorted: allCellCrimeSorted })
    : 1 - Math.exp(-crimeRaw);
  const n = local.length;
  const confidence = n / (n + BAYESIAN_SHRINKAGE_K);
  const environmentRaw = environmentVulnerability(local, {
    isNight,
    cityAverages: cityAverages ?? calculateCityAverages(eligible),
  });
  const environmentBreakdown = {
    lighting: mean(local, 'lighting', mean(eligible, 'lighting')),
    cctv: mean(local, 'cctv', mean(eligible, 'cctv')),
    crowd: mean(local, 'crowd', mean(eligible, 'crowd')),
    police: mean(local, 'police', mean(eligible, 'police')),
  };
  const crime = crimePercentile * confidence + cityMeanCrime * (1 - confidence);
  const environment = environmentRaw * confidence + cityEnv * (1 - confidence);
  const risk = calculateRisk(crime, environment);
  const score = calculateSafeScore(risk);
  const crimeCounts = local.reduce((counts, incident) => {
    const crimeType = incident.crimeType ?? incident.crime_type;
    counts[crimeType] = (counts[crimeType] || 0) + 1;
    return counts;
  }, {});
  const topCrimes = Object.entries(crimeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([crimeType, count]) => ({ crimeType, count }));
  return {
    score,
    label: labelFor(score),
    risk,
    crime,
    environment,
    confidence,
    nIncidents: n,
    nNearby: n,
    radiusM: radiusMeters,
    topCrimes,
    breakdown: {
      crime,
      ...environmentBreakdown,
      environment,
      crimeRaw,
      crimePercentile,
      environmentRaw,
    },
  };
}

export { labelFor };
export const safetyLabel = labelFor;
export const calculateScore = scorePoint;

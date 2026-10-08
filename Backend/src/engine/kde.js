import { EXCLUDED_CRIME_TYPES, SIGMA_SPATIAL_METERS } from '../config/constants.js';
import { bisectLeft, bisectRight } from 'd3-array';
import { coordinates, createSpatialIndex, nearby } from './spatialIndex.js';
import { timeWeight } from './timeWeight.js';

const excluded = (incident, excludedCrimeTypes) =>
  incident.excluded === true || excludedCrimeTypes.includes(incident.crimeType ?? incident.crime_type);

export const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLng = (lng2 - lng1) * radians;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Calculate severity-weighted Gaussian KDE at a point. */
export function kdeAtPoint({
  lat,
  lng,
  incidents = [],
  index = createSpatialIndex(incidents),
  queryHour = 12,
  sigma = SIGMA_SPATIAL_METERS,
  excludedCrimeTypes = EXCLUDED_CRIME_TYPES,
} = {}) {
  const candidates = nearby(index, lat, lng, sigma * 3);
  let total = 0;
  let weightTotal = 0;
  for (const incident of candidates) {
    if (excluded(incident, excludedCrimeTypes)) continue;
    const [iLng, iLat] = coordinates(incident);
    const distance = haversineMeters(lat, lng, iLat, iLng);
    const spatial = Math.exp(-0.5 * (distance / sigma) ** 2);
    const temporal = timeWeight(queryHour, incident.hour ?? 0);
    const recency = incident.recencyWeight ?? 1;
    const w = spatial * temporal * recency;
    total += (incident.severity ?? incident.crime_severity ?? 0) * w;
    weightTotal += w;
  }
  return { value: total, weight: weightTotal, nIncidents: candidates.filter((i) => !excluded(i, excludedCrimeTypes)).length };
}

/** Transform a positive KDE value using the engine's logarithmic scaling. */
export function logKde(value) {
  return Math.log1p(Math.max(0, value));
}

/** Prepare a percentile reference with one sort for repeated rank lookups. */
export function preparePercentileReference(values = []) {
  return values.filter(Number.isFinite).sort((a, b) => a - b);
}

/** Percentile rank (0..1), using the empirical CDF and midpoint ties. */
export function percentileRank(value, values = [], { sorted = false } = {}) {
  const finite = sorted ? values : preparePercentileReference(values);
  if (!finite.length) return 0;
  if (finite.length === 1) return 0;
  const below = bisectLeft(finite, value);
  const equal = bisectRight(finite, value) - below;
  return Math.min(1, Math.max(0, (below + (equal - 1) / 2) / (finite.length - 1)));
}

export const calculatePercentileRank = percentileRank;
export const calculateKDE = kdeAtPoint;

export function kdeRaw(lat, lng, hourQuery, index, options = {}) {
  return kdeAtPoint({
    ...options,
    lat,
    lng,
    queryHour: hourQuery,
    index,
    incidents: options.incidents ?? index?.items ?? [],
  }).value;
}

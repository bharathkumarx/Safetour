export * from './timeWeight.js';
export * from './spatialIndex.js';
export * from './kde.js';
export * from './environment.js';
export * from './scoring.js';

import { EXCLUDED_CRIME_TYPES } from '../config/constants.js';
import { createSpatialIndex } from './spatialIndex.js';
import { environmentVulnerability } from './environment.js';
import { calculateCityAverages, scorePoint as scorePointAtLocation } from './scoring.js';

/**
 * Create a reusable risk-engine instance for a set of incidents.
 *
 * The spatial index and city environment baseline are built once, making the
 * returned `scorePoint` suitable for repeated calls from offline precompute
 * jobs as well as request handlers. `options` may provide `allCellCrime`,
 * `cityMeanCrime`, `cityMeanEnvironment`, and `radiusMeters`.
 *
 * @param {Array<object>} incidents Incident documents or plain incident objects.
 * @param {object} [options] Defaults shared by every score operation.
 * @returns {{incidents: Array<object>, index: object, options: object, scorePoint: Function}}
 */
export function createRiskEngine(incidents = [], options = {}) {
  const source = Array.isArray(incidents) ? incidents : [];
  const excludedTypes = options.excludedCrimeTypes ?? EXCLUDED_CRIME_TYPES;
  const eligible = source.filter(
    (incident) => incident.excluded !== true && !excludedTypes.includes(incident.crimeType ?? incident.crime_type),
  );
  const index = createSpatialIndex(source);
  const defaults = {
    ...options,
    incidents: source,
    eligibleIncidents: eligible,
    index,
    cityAverages: options.cityAverages ?? calculateCityAverages(eligible),
    cityMeanEnvironment: options.cityMeanEnvironment ?? environmentVulnerability(eligible),
  };

  return {
    incidents: source,
    index,
    options: defaults,
    scorePoint(pointOptions = {}) {
      return scorePointAtLocation({ ...defaults, ...pointOptions });
    },
  };
}

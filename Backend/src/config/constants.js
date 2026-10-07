export const BANGALORE_BBOX = { minLat: 12.8, maxLat: 13.18, minLng: 77.45, maxLng: 77.8 };
export const H3_RESOLUTION = 9;
export const SIGMA_TIME_HOURS = 2.5;
export const SIGMA_SPATIAL_METERS = 300;
export const RECENCY_HALF_LIFE_DAYS = 365;
export const TIME_BANDS = {
  Morning: { start: 5, end: 11, representativeHour: 8 },
  Afternoon: { start: 11, end: 17, representativeHour: 14 },
  Evening: { start: 17, end: 20, representativeHour: 18 },
  Night: { start: 20, end: 5, representativeHour: 23 },
};
export const ENVIRONMENT_WEIGHTS = { lighting: 0.3, cctv: 0.25, police: 0.25, crowd: 0.2 };
export const CRIME_RISK_WEIGHT = 0.6;
export const ENVIRONMENT_RISK_WEIGHT = 0.4;
export const BAYESIAN_SHRINKAGE_K = 5;
export const K = 5;
export const ROUTING_RISK_LAMBDA = 1;
export const MAX_DETOUR_FACTOR = 1.5;
export const EXCLUDED_CRIME_TYPES = ['Cybercrime'];
export const EXCLUDED_AREAS_FROM_RANKING = ['Random Spread'];
export const SAFETY_LABELS = [
  { min: 80, max: 100, label: 'Very Safe' },
  { min: 65, max: 79, label: 'Safe' },
  { min: 50, max: 64, label: 'Moderate' },
  { min: 35, max: 49, label: 'Caution' },
  { min: 0, max: 34, label: 'High Caution' },
];

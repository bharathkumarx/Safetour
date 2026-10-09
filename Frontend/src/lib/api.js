import { useQuery } from '@tanstack/react-query';

const normalizeBaseUrl = (value = '') => value.trim().replace(/\/+$/, '');
const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL || '');

/**
 * @typedef {Object} ApiErrorShape
 * @property {string} code
 * @property {string} message
 * @property {unknown} [details]
 */

/**
 * @extends Error
 */
export class ApiError extends Error {
  constructor(code, message, details = null, status = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function shouldRetryRequest(error, failureCount) {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) {
    return ![400, 401, 403, 404, 422, 429].includes(error.status);
  }
  return true;
}

async function request(path, options = {}) {
  if (!API_BASE_URL) {
    throw new ApiError('CONFIG_ERROR', 'VITE_API_URL is not configured.');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorPayload = payload && payload.error ? payload.error : {};
    throw new ApiError(
      errorPayload.code || 'HTTP_ERROR',
      errorPayload.message || `Request failed with status ${response.status}`,
      errorPayload.details || null,
      response.status,
    );
  }

  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

/**
 * Fetch the meta endpoint used by the filter panel.
 * @returns {ReturnType<typeof useQuery>}
 */
export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: ({ signal }) => request('/api/v1/meta', { signal }),
    staleTime: 30_000,
    retry: shouldRetryRequest,
    retryOnMount: false,
    refetchOnReconnect: false,
  });
}

/**
 * Fetch the current data freshness and status metadata.
 * @returns {ReturnType<typeof useQuery>}
 */
export function useDataStatus() {
  return useQuery({
    queryKey: ['data-status'],
    queryFn: ({ signal }) => request('/api/v1/data-status', { signal }),
    staleTime: 30_000,
    retry: shouldRetryRequest,
    retryOnMount: false,
    refetchOnReconnect: false,
  });
}

/**
 * Build a query string for /api/v1/heatmap using the various filter settings.
 * @param {Object} [params]
 * @param {number} [params.hour]
 * @param {string} [params.timeBand]
 * @param {'risk'|'density'} [params.layer]
 * @param {string|string[]} [params.crimeType]
 * @param {string} [params.from]
 * @param {string} [params.to]
 * @param {string} [params.bbox]
 * @returns {string}
 */
export function buildHeatmapQuery(params = {}) {
  const searchParams = new URLSearchParams();
  const { hour, timeBand, layer = 'risk', crimeType = [], from, to, bbox } = params;

  if (hour !== undefined && hour !== null) {
    searchParams.set('hour', String(hour));
  }
  if (timeBand) {
    searchParams.set('timeBand', timeBand);
  }
  if (layer) {
    searchParams.set('layer', layer);
  }
  if (from) {
    searchParams.set('from', from);
  }
  if (to) {
    searchParams.set('to', to);
  }
  if (bbox) {
    searchParams.set('bbox', bbox);
  }

  const crimeTypes = Array.isArray(crimeType) ? crimeType : [crimeType].filter(Boolean);
  crimeTypes.forEach((value) => searchParams.append('crimeType', value));

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Fetch the current heatmap payload based on the selected time and filters.
 * @param {Object} [params]
 * @returns {ReturnType<typeof useQuery>}
 */
export function useHeatmap(params = {}) {
  const queryKey = [
    'heatmap',
    params.hour ?? null,
    params.timeBand ?? null,
    params.layer || 'risk',
    Array.isArray(params.crimeType) ? params.crimeType : [params.crimeType].filter(Boolean),
    params.from || null,
    params.to || null,
    params.bbox || null,
  ];

  return useQuery({
    queryKey,
    queryFn: ({ signal }) => request(`/api/v1/heatmap${buildHeatmapQuery(params)}`, { signal }),
    staleTime: 15_000,
    retry: shouldRetryRequest,
    retryOnMount: false,
    refetchOnReconnect: false,
  });
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

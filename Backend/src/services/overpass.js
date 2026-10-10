import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, validateOverpassUserAgent } from '../config/env.js';

export const DEFAULT_ENDPOINTS = ['https://overpass-api.de/api/interpreter'];
export const MAX_ATTEMPTS = 8;
export const BACKOFF_START_MS = 15000;
export const BACKOFF_CAP_MS = 300000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultCacheDir = path.join(repoRoot, 'Data/processed/overpass');

export function buildOverpassQuery(bbox, mode = 'drive') {
  const [south, west, north, east] = bbox;
  const highway = mode === 'walk'
    ? '["highway"~"footway|pedestrian|path|steps|living_street|residential|unclassified|tertiary|secondary|primary|trunk|motorway"]'
    : '["highway"~"motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street"]';
  return `[out:json][timeout:180];way${highway}(${south},${west},${north},${east});out body;>;out skel qt;`;
}

export function parseOverpass(data, mode = 'drive') {
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  const nodes = new Map(elements.filter((e) => e.type === 'node' && Number.isFinite(e.lat) && Number.isFinite(e.lon))
    .map((e) => [String(e.id), { id: String(e.id), lat: e.lat, lng: e.lon }]));
  const ways = [];
  for (const way of elements.filter((e) => e.type === 'way')) {
    const tags = way.tags || {};
    if (tags.access === 'private' || tags.access === 'no' || tags.vehicle === 'no' || tags.motor_vehicle === 'no') continue;
    if (mode === 'walk' && tags.foot === 'no') continue;
    const refs = (way.nodes || []).map(String).filter((id) => nodes.has(id));
    if (refs.length > 1) ways.push({ id: String(way.id), nodes: refs, tags, mode });
  }
  return { nodes: [...nodes.values()], ways };
}

export function cachePathForTile(bbox, mode = 'drive', cacheDir = defaultCacheDir) {
  const key = `blr_${mode}_${bbox.map((v) => Number(v).toFixed(5)).join('_')}.json`;
  return path.resolve(cacheDir, key);
}

const endpointState = new Map();
function stateFor(endpoint) {
  if (!endpointState.has(endpoint)) endpointState.set(endpoint, { nextAt: 0 });
  return endpointState.get(endpoint);
}

function retryAfterMs(response) {
  const value = response.headers?.get?.('retry-after') ?? response.headers?.['retry-after'];
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function statusEndpoint(endpoint) {
  return endpoint.replace(/\/interpreter\/?$/, '/status');
}

function timeoutSignal(stallMinutes = env.OVERPASS_STALL_MINUTES) {
  const ms = Math.max(1, stallMinutes * 60 * 1000);
  if (typeof AbortSignal?.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

function event(onEvent, details) {
  onEvent({ ...details, elapsed: details.elapsed ?? 0 });
}

export async function overpassStatus({ endpoints = env.OVERPASS_URLS.split(',').map((v) => v.trim()).filter(Boolean), fetchImpl = globalThis.fetch, userAgent = env.OVERPASS_USER_AGENT, logger = () => {} } = {}) {
  validateOverpassUserAgent(userAgent);
  const results = [];
  for (const endpoint of endpoints) {
    const started = Date.now();
    try {
      const response = await fetchImpl(statusEndpoint(endpoint), { method: 'GET', headers: { 'user-agent': userAgent }, signal: timeoutSignal() });
      const text = typeof response.text === 'function' ? await response.text() : '';
      const parsed = response.ok && text ? text : null;
      results.push({ endpoint, status: response.status, text: parsed });
      if (!parsed || response.status === 406) logger(`status unknown`);
    } catch {
      results.push({ endpoint, status: null, text: null });
      logger('status unknown');
    }
    results.at(-1).elapsed = Date.now() - started;
  }
  return results;
}

export function resetEndpointState() {
  endpointState.clear();
}

export async function fetchOverpassTile(bbox, {
  mode = 'drive', cacheDir = defaultCacheDir, endpoints = env.OVERPASS_URLS.split(',').map((v) => v.trim()).filter(Boolean),
  retries = MAX_ATTEMPTS, fetchImpl = globalThis.fetch, paceMs = env.OVERPASS_TILE_DELAY_MS,
  sleepImpl = sleep, logger = () => {}, onAttempt = () => {}, onEvent = () => {}, useCache = true,
  userAgent = env.OVERPASS_USER_AGENT,
  stallMinutes = env.OVERPASS_STALL_MINUTES,
  fromCache = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const cachePath = cachePathForTile(bbox, mode, cacheDir);
  const started = Date.now();
  try {
    if (!useCache) throw Object.assign(new Error('cache bypassed'), { code: 'ENOENT' });
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    event(onEvent, { event: 'cache-hit', status: 'cached', elapsed: Date.now() - started });
    return parseOverpass(cached, mode);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
  }
  if (fromCache) {
    const error = new Error(`cached Overpass tile is missing: ${cachePath}`);
    error.code = 'CACHE_MISS';
    throw error;
  }
  const query = buildOverpassQuery(bbox, mode);
  let lastError;
  const attempts = Math.min(MAX_ATTEMPTS, Math.max(1, retries));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const endpoint of endpoints) {
      try {
        const state = stateFor(endpoint);
        const wait = Math.max(0, state.nextAt - Date.now());
        if (wait) { logger(`waiting ${wait}ms for ${endpoint}`); event(onEvent, { event: 'wait', status: 'paced', wait, why: 'endpoint gap', attempt: attempt + 1, elapsed: Date.now() - started }); await sleepImpl(wait); }
        const statusResponse = await fetchImpl(statusEndpoint(endpoint), { method: 'GET', headers: { 'user-agent': userAgent }, signal: timeoutSignal(stallMinutes) });
        const statusText = typeof statusResponse.text === 'function' ? await statusResponse.text() : '';
        if (!statusResponse.ok || statusResponse.status === 406 || !statusText) {
          logger('status unknown');
          event(onEvent, { event: 'http-status', status: statusResponse.status, why: 'status advisory', attempt: attempt + 1, elapsed: Date.now() - started });
        }
        state.nextAt = Date.now() + paceMs;
        onAttempt({ endpoint, attempt: attempt + 1 });
        event(onEvent, { event: 'request', status: 'started', attempt: attempt + 1, elapsed: Date.now() - started });
        const response = await fetchImpl(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': userAgent }, signal: timeoutSignal(stallMinutes) });
        event(onEvent, { event: 'http-status', status: response.status, attempt: attempt + 1, elapsed: Date.now() - started });
        if (!response.ok) {
          const error = new Error(`Overpass HTTP ${response.status}`);
          error.status = response.status;
          error.retryAfterMs = (response.status === 429 || response.status === 504) ? retryAfterMs(response) : null;
          throw error;
        }
        const json = await response.json();
        await fs.mkdir(cacheDir, { recursive: true });
        const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(json));
        await fs.rename(temporary, cachePath);
        event(onEvent, { event: 'stored', status: 'ok', attempt: attempt + 1, elapsed: Date.now() - started });
        return parseOverpass(json, mode);
      } catch (error) {
        lastError = error;
        event(onEvent, { event: 'failed', status: error.status || error.name || 'error', why: error.message, attempt: attempt + 1, elapsed: Date.now() - started });
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          error.message = `Overpass request stalled after ${stallMinutes} minutes`;
          error.code = 'OVERPASS_STALL';
          throw error;
        }
      }
    }
    if (attempt + 1 < attempts) {
      const retryWait = lastError?.retryAfterMs ?? Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * (2 ** attempt)) * (0.5 + Math.random());
      const boundedWait = Math.min(BACKOFF_CAP_MS, retryWait);
      logger(`retry ${attempt + 1}/${attempts - 1} in ${Math.round(boundedWait)}ms`);
      event(onEvent, { event: 'retry', status: lastError?.status || 'error', retryAfter: lastError?.retryAfterMs ?? '-', wait: boundedWait, why: lastError?.retryAfterMs != null ? 'Retry-After' : 'exponential backoff', attempt: attempt + 1, elapsed: Date.now() - started });
      const beforeSleep = Date.now();
      await sleepImpl(boundedWait);
      event(onEvent, { event: 'wait', status: 'complete', wait: Date.now() - beforeSleep, why: 'retry', attempt: attempt + 1, elapsed: Date.now() - started });
    }

  }
  throw new Error(`Overpass tile failed: ${lastError?.message || 'unknown error'}`);
}

export function tileBboxes([south, west, north, east], rows = 4, cols = 4) {
  const out = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const s = south + (north - south) * r / rows; const n = south + (north - south) * (r + 1) / rows;
    const w = west + (east - west) * c / cols; const e = west + (east - west) * (c + 1) / cols;
    out.push([s, w, n, e]);
  }

  return out;
}

export async function cachedTileStatus({ cacheDir = defaultCacheDir, bounds = [12.80, 77.45, 13.18, 77.80], modes = ['drive', 'walk'] } = {}) {
  const boxes = tileBboxes(bounds);
  const out = [];
  for (const mode of modes) for (let i = 0; i < boxes.length; i += 1) {
    const file = cachePathForTile(boxes[i], mode, cacheDir);
    try {
      const stat = await fs.stat(file);
      out.push({ mode, index: i + 1, size: stat.size, age: Date.now() - stat.mtimeMs });
    } catch { out.push({ mode, index: i + 1, missing: true }); }
  }
  return out;
}

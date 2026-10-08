import NodeCache from 'node-cache';
import { Router } from 'express';
import { z } from 'zod';
import { latLngToCell, cellToLatLng } from 'h3-js';
import { BANGALORE_BBOX, EXCLUDED_AREAS_FROM_RANKING, EXCLUDED_CRIME_TYPES, TIME_BANDS } from '../config/constants.js';
import { validate } from '../middleware/validate.js';
import { getBaselineHash } from '../services/dataFreshness.js';
import { getDataStore } from '../services/dataStore.js';
import { createRiskEngine } from '../engine/riskEngine.js';

const coordinate = (min, max) => z.coerce.number().finite().min(min).max(max);
const hour = z.coerce.number().int().min(0).max(23);
const pointSchema = z.object({
  lat: coordinate(BANGALORE_BBOX.minLat, BANGALORE_BBOX.maxLat),
  lng: coordinate(BANGALORE_BBOX.minLng, BANGALORE_BBOX.maxLng),
  hour: hour.default(12),
});
const bandForHour = (value) => Object.entries(TIME_BANDS).find(([, band]) =>
  band.start < band.end ? value >= band.start && value < band.end : value >= band.start || value < band.end,
)[0];
const freshness = (metadata) => metadata && ({
  dataThrough: metadata.latestIncidentAt ?? null,
  isSynthetic: metadata.isSynthetic,
  dataVersion: metadata.dataVersion,
});
const completeFreshness = (metadata) => metadata && ({
  latestIncidentAt: metadata.latestIncidentAt ?? null,
  historicalStart: metadata.historicalDataStart ?? null,
  historicalEnd: metadata.historicalDataEnd ?? null,
  lastIngestedAt: metadata.lastIngestedAt ?? null,
  incidentCount: metadata.incidentCount ?? 0,
  isSynthetic: metadata.isSynthetic,
  dataVersion: metadata.dataVersion,
  freshnessLabel: metadata.isSynthetic ? 'Historical/demo data — not a live crime feed' : 'Authorized operational data',
});
const engineFor = (store, band, incidents = store.incidents) => createRiskEngine(incidents, {
  allCellCrime: store.metadata?.percentileReferences?.[band] ?? store.metadata?.percentileReference ?? [],
  allCellCrimeSorted: true,
  cityMeanCrime: store.metadata?.cityMeanRisk ?? 0.5,
  index: incidents === store.incidents ? store.index : undefined,
});
const feature = ({ h3, lat, lng, score, n, weight }) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { h3, weight, score, n },
});
const parseBbox = (value) => {
  if (!value) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng < BANGALORE_BBOX.minLng || maxLng > BANGALORE_BBOX.maxLng || minLat < BANGALORE_BBOX.minLat || maxLat > BANGALORE_BBOX.maxLat || minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
};

const placeCache = new NodeCache({ stdTTL: 3600 });
let lastNominatimRequestAt = 0;
const waitForNominatimSlot = async () => {
  const waitMs = Math.max(0, 1000 - (Date.now() - lastNominatimRequestAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastNominatimRequestAt = Date.now();
};
export const apiRouter = Router();

apiRouter.get('/meta', async (req, res, next) => {
  try {
    const store = getDataStore();
    const eligible = store.incidents.filter((incident) => !incident.excluded && !EXCLUDED_CRIME_TYPES.includes(incident.crimeType));
    res.json({
      crimeTypes: [...new Set(eligible.map((incident) => incident.crimeType))].sort(),
      historicalDateRange: { start: store.metadata?.historicalDataStart ?? null, end: store.metadata?.historicalDataEnd ?? null },
      areas: [...new Set(eligible.map((incident) => incident.area))].sort(),
      bbox: BANGALORE_BBOX,
      dataVersion: store.dataVersion,
      isSynthetic: store.metadata?.isSynthetic ?? true,
      latestIncidentAt: store.metadata?.latestIncidentAt ?? null,
      lastIngestedAt: store.metadata?.lastIngestedAt ?? null,
      freshness: completeFreshness(store.metadata),
    });
  } catch (error) { next(error); }
});

apiRouter.get('/data-status', async (req, res, next) => {
  try {
    res.json(completeFreshness(getDataStore().metadata) ?? {
      latestIncidentAt: null, historicalStart: null, historicalEnd: null, lastIngestedAt: null,
      incidentCount: 0, isSynthetic: true, dataVersion: null, freshnessLabel: 'Historical/demo data — not a live crime feed',
    });
  } catch (error) { next(error); }
});

const scoreHandler = (req, res, next) => {
  try {
    const store = getDataStore();
    const band = bandForHour(req.query.hour);
    const result = engineFor(store, band).scorePoint(req.query);
    res.json({
      ...result,
      score10: result.score / 10,
      dataFreshness: freshness(store.metadata),
    });
  } catch (error) { next(error); }
};
apiRouter.get('/score', validate(pointSchema), scoreHandler);

const heatmapSchema = z.object({
  hour: hour.optional(),
  timeBand: z.enum(Object.keys(TIME_BANDS)).optional(),
  crimeType: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  layer: z.enum(['risk', 'density']).default('risk'),
  bbox: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && value.from > value.to) ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must be before to' });
  if (value.bbox && !parseBbox(value.bbox)) ctx.addIssue({ code: 'custom', path: ['bbox'], message: 'bbox must be inside Bangalore' });
});
apiRouter.get('/heatmap', validate(heatmapSchema), (req, res, next) => {
  try {
    const store = getDataStore();
    const band = req.query.timeBand ?? bandForHour(req.query.hour ?? TIME_BANDS.Morning.representativeHour);
    const bbox = parseBbox(req.query.bbox);
    const types = req.query.crimeType ? (Array.isArray(req.query.crimeType) ? req.query.crimeType : [req.query.crimeType]) : null;
    const filtered = store.incidents.filter((incident) => {
      if (incident.excluded || EXCLUDED_CRIME_TYPES.includes(incident.crimeType)) return false;
      if (types && !types.includes(incident.crimeType)) return false;
      if (req.query.from && incident.timestamp < req.query.from) return false;
      if (req.query.to && incident.timestamp > req.query.to) return false;
      const [lng, lat] = incident.location.coordinates;
      return !bbox || (lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng);
    });
    let cells;
    if (!types && !req.query.from && !req.query.to && !bbox) {
      cells = [...store.cellRisks.values()].filter((cell) => cell.band === band).slice(0, 5000)
        .map((cell) => feature({ h3: cell.h3, lat: cell.lat, lng: cell.lng, score: cell.score, n: cell.nIncidents, weight: req.query.layer === 'density' ? Math.min(1, cell.nIncidents / 20) : cell.score / 100 }));
    } else {
      const grouped = new Map();
      for (const incident of filtered) {
        const [lng, lat] = incident.location.coordinates;
        const h3 = latLngToCell(lat, lng, 9);
        if (!grouped.has(h3)) grouped.set(h3, { h3, lat, lng, n: 0 });
        grouped.get(h3).n += 1;
      }
      const engine = engineFor(store, band, filtered);
      cells = [...grouped.values()].slice(0, 5000).map((cell) => {
        const [lat, lng] = cellToLatLng(cell.h3);
        const result = engine.scorePoint({ lat, lng, hour: TIME_BANDS[band].representativeHour });
        return feature({ ...cell, lat, lng, score: result.score, n: cell.n, weight: req.query.layer === 'density' ? Math.min(1, cell.n / 20) : result.score / 100 });
      });
    }
    res.json({ type: 'FeatureCollection', timeBand: band, features: cells, dataFreshness: freshness(store.metadata) });
  } catch (error) { next(error); }
});

apiRouter.get('/areas', validate(z.object({ hour: hour.default(12) })), (req, res, next) => {
  try {
    const store = getDataStore();
    const band = bandForHour(req.query.hour);
    const grouped = new Map();
    for (const incident of store.incidents.filter((item) => !item.excluded)) {
      if (!grouped.has(incident.area)) grouped.set(incident.area, []);
      grouped.get(incident.area).push(incident);
    }
    const rows = [...grouped.entries()].filter(([area]) => !EXCLUDED_AREAS_FROM_RANKING.includes(area)).map(([area, incidents]) => {
      const lat = incidents.reduce((sum, incident) => sum + incident.location.coordinates[1], 0) / incidents.length;
      const lng = incidents.reduce((sum, incident) => sum + incident.location.coordinates[0], 0) / incidents.length;
      const result = engineFor(store, band).scorePoint({ lat, lng, hour: req.query.hour });
      return { area, score: result.score, label: result.label, confidence: result.confidence };
    }).sort((a, b) => b.score - a.score).map((row, index) => ({ ...row, rank: index + 1 }));
    res.json({ areas: rows, dataFreshness: freshness(store.metadata) });
  } catch (error) { next(error); }
});

apiRouter.get('/places/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'q is required' } });
    const key = q.toLowerCase();
    const cached = placeCache.get(key);
    if (cached) return res.json(cached);
    await waitForNominatimSlot();
    const params = new URLSearchParams({
      q, format: 'jsonv2', addressdetails: '1', limit: '5', bounded: '1', countrycodes: 'in',
      viewbox: `${BANGALORE_BBOX.minLng},${BANGALORE_BBOX.maxLat},${BANGALORE_BBOX.maxLng},${BANGALORE_BBOX.minLat}`,
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'User-Agent': 'SafeTour/1.0 contact@example.invalid' } });
    if (!response.ok) {
      const error = new Error('Place search upstream unavailable');
      error.statusCode = 502;
      error.code = 'UPSTREAM_ERROR';
      throw error;
    }
    const results = (await response.json()).filter((item) => {
      const lat = Number(item.lat); const lng = Number(item.lon);
      return lat >= BANGALORE_BBOX.minLat && lat <= BANGALORE_BBOX.maxLat && lng >= BANGALORE_BBOX.minLng && lng <= BANGALORE_BBOX.maxLng;
    });
    const payload = { results };
    placeCache.set(key, payload);
    return res.json(payload);
  } catch (error) { return next(error); }
});

apiRouter.get('/baseline', async (req, res, next) => {
  try { res.json({ baselineHash: await getBaselineHash() }); } catch (error) { next(error); }
});

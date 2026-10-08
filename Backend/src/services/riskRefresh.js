import { cellToLatLng, gridDisk } from 'h3-js';
import { SIGMA_SPATIAL_METERS, TIME_BANDS } from '../config/constants.js';
import { CellRisk, Metadata } from '../models/CellRisk.js';
import { Incident } from '../models/Incident.js';
import { createRiskEngine } from '../engine/riskEngine.js';
import { haversineMeters } from '../engine/kde.js';
import { createSpatialIndex } from '../engine/spatialIndex.js';
import { runCellChangeHooks } from './riskEvents.js';

const distance = (a, b) => haversineMeters(a[0], a[1], b[0], b[1]);
const rings = Math.ceil(900 / 170) + 1;

export function affectedCellsFor(incidents) {
  const cells = new Map();
  for (const incident of incidents.filter((item) => !item.excluded)) {
    const [lng, lat] = incident.location.coordinates;
    for (const h3 of gridDisk(incident.h3r9, rings)) {
      const [cellLat, cellLng] = cellToLatLng(h3);
      if (distance([lat, lng], [cellLat, cellLng]) <= SIGMA_SPATIAL_METERS * 3) {
        cells.set(h3, { h3, lat: cellLat, lng: cellLng });
      }
    }
  }
  return [...cells.values()];
}

export async function refreshAffectedCells(newIncidents, { cellIds } = {}) {
  const started = performance.now();
  const metadata = await Metadata.findOne({}).lean();
  const incidents = await Incident.find({}).lean();
  const eligible = incidents.filter((incident) => !incident.excluded);
  const cells = cellIds
    ? cellIds.map((h3) => {
        const [lat, lng] = cellToLatLng(h3);
        return { h3, lat, lng };
      })
    : affectedCellsFor(newIncidents);
  if (!cells.length) return { affectedCells: 0, refreshedRecords: 0, elapsedMs: Math.round(performance.now() - started) };
  const engine = createRiskEngine(incidents, {
    allCellCrime: metadata?.percentileReference ?? [],
    allCellCrimeSorted: true,
    cityMeanCrime: metadata?.cityMeanRisk ?? 0.5,
    radiusMeters: 900,
  });
  const operations = [];
  for (const cell of cells) {
    for (const [band, config] of Object.entries(TIME_BANDS)) {
      const result = engine.scorePoint({ lat: cell.lat, lng: cell.lng, hour: config.representativeHour });
      operations.push({
        updateOne: {
          filter: { h3: cell.h3, band },
          update: {
            $set: {
              h3: cell.h3,
              band,
              nIncidents: result.nNearby,
              crime: result.crime,
              env: result.environment,
              risk: result.risk,
              score: result.score,
              confidence: result.confidence,
              lat: cell.lat,
              lng: cell.lng,
            },
          },
          upsert: true,
        },
      });
    }
  }
  await CellRisk.bulkWrite(operations, { ordered: false });
  if (newIncidents.length) {
    const timestamps = incidents.map((incident) => new Date(incident.timestamp).getTime());
    const ingestSequence = (metadata?.ingestSequence ?? 0) + 1;
    await Metadata.findOneAndUpdate(
      {},
      {
        $set: {
          ingestSequence,
          dataVersion: `${metadata.baselineHash}+${ingestSequence}`,
          latestIncidentAt: new Date(Math.max(...timestamps)),
          lastIngestedAt: new Date(),
          historicalDataStart: new Date(Math.min(...timestamps)),
          historicalDataEnd: new Date(Math.max(...timestamps)),
          isSynthetic: true,
          incidentCount: incidents.length,
        },
      },
      { upsert: true, new: true },
    );
  }
  await runCellChangeHooks(cells.map((cell) => cell.h3));
  return { affectedCells: cells.length, refreshedRecords: operations.length, elapsedMs: Math.round(performance.now() - started) };
}

import path from 'node:path';
import mongoose from 'mongoose';
import { cellToLatLng, polygonToCells } from 'h3-js';
import { env } from '../src/config/env.js';
import { BANGALORE_BBOX, H3_RESOLUTION, TIME_BANDS } from '../src/config/constants.js';
import { CellRisk, Metadata } from '../src/models/CellRisk.js';
import { Incident } from '../src/models/Incident.js';
import { createRiskEngine } from '../src/engine/riskEngine.js';
import { kdeAtPoint, logKde, preparePercentileReference } from '../src/engine/kde.js';
import { createSpatialIndex } from '../src/engine/spatialIndex.js';
import { readDataset } from './seedIncidents.js';

const started = performance.now();
const phaseStarted = { load: started };
const bbox = [
  [BANGALORE_BBOX.minLat, BANGALORE_BBOX.minLng],
  [BANGALORE_BBOX.maxLat, BANGALORE_BBOX.minLng],
  [BANGALORE_BBOX.maxLat, BANGALORE_BBOX.maxLng],
  [BANGALORE_BBOX.minLat, BANGALORE_BBOX.maxLng],
  [BANGALORE_BBOX.minLat, BANGALORE_BBOX.minLng],
];

const dataFile = path.resolve(process.cwd(), '../Data/bangalore_crime_dataset.csv');
const dataset = await readDataset(dataFile);
await mongoose.connect(env.MONGODB_URI);
const incidents = await Incident.find({}).lean();
if (!incidents.length) {
  throw new Error('No incidents found. Run npm run seed before npm run build:risk.');
}

const eligible = incidents.filter((incident) => !incident.excluded);
const index = createSpatialIndex(eligible);
const cellIds = polygonToCells(bbox, H3_RESOLUTION);
const cells = cellIds.map((h3) => {
  const [lat, lng] = cellToLatLng(h3);
  return { h3, lat, lng };
});
const loadMs = performance.now() - phaseStarted.load;
const computeStarted = performance.now();
const crimeReferences = [];
for (const [bandName, band] of Object.entries(TIME_BANDS)) {
  for (const cell of cells) {
    crimeReferences.push(logKde(kdeAtPoint({
      lat: cell.lat,
      lng: cell.lng,
      queryHour: band.representativeHour,
      incidents: eligible,
      index,
    }).value));
  }
  console.log(
    `[compute] phase=reference band=${bandName} cells=${cells.length}/${cells.length} total=${cells.length} elapsed=${Math.round(
      performance.now() - computeStarted,
    )}ms`,
  );
}
const sortedCrimeReferences = preparePercentileReference(crimeReferences);
const cityMeanCrime = 0.5;
const engine = createRiskEngine(incidents, {
  allCellCrime: sortedCrimeReferences,
  allCellCrimeSorted: true,
  cityMeanCrime,
  radiusMeters: 900,
});
const documents = [];
const writeStarted = performance.now();
await CellRisk.deleteMany({});
for (const [bandName, band] of Object.entries(TIME_BANDS)) {
  for (const cell of cells) {
    const result = engine.scorePoint({ lat: cell.lat, lng: cell.lng, hour: band.representativeHour });
    documents.push({
      h3: cell.h3,
      band: bandName,
      nIncidents: result.nNearby,
      crime: result.crime,
      env: result.environment,
      risk: result.risk,
      score: result.score,
      confidence: result.confidence,
      lat: cell.lat,
      lng: cell.lng,
    });
  }
  console.log(
    `[compute] phase=scores band=${bandName} cells=${cells.length}/${cells.length} total=${documents.length} elapsed=${Math.round(
      performance.now() - computeStarted,
    )}ms`,
  );
}
const computeMs = performance.now() - computeStarted;
for (let offset = 0; offset < documents.length; offset += 2000) {
  const operations = documents.slice(offset, offset + 2000).map((document) => ({ insertOne: { document } }));
  await CellRisk.bulkWrite(operations, { ordered: false });
}
await Metadata.findOneAndUpdate(
  { key: 'dataVersion' },
  { key: 'dataVersion', value: dataset.hash },
  { upsert: true, new: true },
);
const writeMs = performance.now() - writeStarted;
console.log(
  `Timing: load incidents=${Math.round(loadMs)}ms, compute=${Math.round(computeMs)}ms, write MongoDB=${Math.round(
    writeMs,
  )}ms, total=${Math.round(performance.now() - started)}ms`,
);
console.log(`Built ${documents.length} cell risks across ${cells.length} H3 cells`);
console.log(`dataVersion: ${dataset.hash}`);
await mongoose.disconnect();

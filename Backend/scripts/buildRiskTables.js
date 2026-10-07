import path from 'node:path';
import mongoose from 'mongoose';
import { cellToLatLng, polygonToCells } from 'h3-js';
import { env } from '../src/config/env.js';
import { BANGALORE_BBOX, H3_RESOLUTION, TIME_BANDS } from '../src/config/constants.js';
import { CellRisk, Metadata } from '../src/models/CellRisk.js';
import { Incident } from '../src/models/Incident.js';
import { createRiskEngine } from '../src/engine/riskEngine.js';
import { kdeAtPoint, logKde } from '../src/engine/kde.js';
import { createSpatialIndex } from '../src/engine/spatialIndex.js';
import { readDataset } from './seedIncidents.js';

const started = performance.now();
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
const crimeReferences = [];
for (const cell of cells) {
  for (const band of Object.values(TIME_BANDS)) {
    crimeReferences.push(logKde(kdeAtPoint({
      lat: cell.lat,
      lng: cell.lng,
      queryHour: band.representativeHour,
      incidents: eligible,
      index,
    }).value));
  }
}
const cityMeanCrime = 0.5;
const engine = createRiskEngine(incidents, {
  allCellCrime: crimeReferences,
  cityMeanCrime,
  radiusMeters: 900,
});
const documents = [];
let offset = 0;
await CellRisk.deleteMany({});
for (const cell of cells) {
  for (const [bandName, band] of Object.entries(TIME_BANDS)) {
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
    if (documents.length - offset >= 1000) {
      await CellRisk.insertMany(documents.slice(offset));
      offset = documents.length;
    }
  }
}
if (documents.length) await CellRisk.insertMany(documents.slice(offset));
await Metadata.findOneAndUpdate(
  { key: 'dataVersion' },
  { key: 'dataVersion', value: dataset.hash },
  { upsert: true, new: true },
);
console.log(`Built ${documents.length} cell risks across ${cells.length} H3 cells in ${Math.round(performance.now() - started)}ms`);
console.log(`dataVersion: ${dataset.hash}`);
await mongoose.disconnect();

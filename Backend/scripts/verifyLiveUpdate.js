import path from 'node:path';
import mongoose from 'mongoose';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { env } from '../src/config/env.js';
import { Incident } from '../src/models/Incident.js';
import { CellRisk, Metadata } from '../src/models/CellRisk.js';
import { createRiskEngine } from '../src/engine/riskEngine.js';
import { csvSource } from '../src/services/incidentSource.js';
import { ingestRows } from '../src/services/incidentIngestion.js';
import { refreshAffectedCells } from '../src/services/riskRefresh.js';
import { reload } from '../src/services/dataStore.js';
import { execFileSync } from 'node:child_process';

const point = { lat: 12.9352, lng: 77.6245 };
const h3 = latLngToCell(point.lat, point.lng, 9);
const score = async (hour) => {
  const incidents = await Incident.find({}).lean();
  const metadata = await Metadata.findOne({}).lean();
  const engine = createRiskEngine(incidents, {
    allCellCrime: metadata.percentileReference,
    allCellCrimeSorted: true,
    cityMeanCrime: metadata.cityMeanRisk,
  });
  const result = engine.scorePoint({ ...point, hour });
  const band = hour >= 5 && hour < 11
    ? 'Morning'
    : hour >= 11 && hour < 17
      ? 'Afternoon'
      : hour >= 17 && hour < 20
        ? 'Evening'
        : 'Night';
  const stored = await CellRisk.findOne({ h3, band }).lean();
  return { result, stored };
};

execFileSync('node', [path.resolve(process.cwd(), 'scripts/demoReset.js')], { stdio: 'inherit' });
await mongoose.connect(env.MONGODB_URI);
const before = { 22: await score(22), 23: await score(23) };
const rows = csvSource.fetchRows({ filePath: path.resolve(process.cwd(), '../Data/demo_live_incidents.csv') });
const ingestion = await ingestRows(rows, { source: 'demo', deferMetadata: true });
const refresh = await refreshAffectedCells(ingestion.insertedIncidents);
await reload();
const after = { 22: await score(22), 23: await score(23) };
console.table(
  [22, 23].map((hour) => ({
    hour,
    before: before[hour].result.score,
    after: after[hour].result.score,
    score: `${before[hour].result.score} -> ${after[hour].result.score}`,
    score10: `${(before[hour].result.score / 10).toFixed(1)} -> ${(after[hour].result.score / 10).toFixed(1)}`,
    label: `${before[hour].result.label} -> ${after[hour].result.label}`,
    risk: `${before[hour].result.risk.toFixed(4)} -> ${after[hour].result.risk.toFixed(4)}`,
    C: `${before[hour].result.crime.toFixed(4)} -> ${after[hour].result.crime.toFixed(4)}`,
    E: `${before[hour].result.environment.toFixed(4)} -> ${after[hour].result.environment.toFixed(4)}`,
    confidence: `${before[hour].result.confidence.toFixed(4)} -> ${after[hour].result.confidence.toFixed(4)}`,
    nNearby: `${before[hour].result.nNearby} -> ${after[hour].result.nNearby}`,
    affectedCells: refresh.affectedCells,
    storedScore: `${before[hour].stored?.score ?? 'n/a'} -> ${after[hour].stored?.score ?? 'n/a'}`,
    crimePercentile: `${before[hour].result.breakdown.crimePercentile.toFixed(4)} -> ${after[hour].result.breakdown.crimePercentile.toFixed(4)}`,
    cityMeanCrime: `${before[hour].result.crime - before[hour].result.breakdown.crimePercentile * before[hour].result.confidence} -> ${
      after[hour].result.crime - after[hour].result.breakdown.crimePercentile * after[hour].result.confidence
    }`,
  })),
);
if ([22, 23].some((hour) => after[hour].result.score > before[hour].result.score)) {
  console.error('SafeScore increased after demo ingestion; inspect C, E, and shrinkage terms above.');
  process.exitCode = 1;
}
await mongoose.disconnect();

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
import { onCellsChanged } from '../src/services/riskEvents.js';
import { registerEdgeRiskRefresh } from '../src/services/edgeRiskRefresh.js';
import { loadRoutingGraph } from '../src/routing/graph.js';

const point = { lat: 12.9582, lng: 77.6959 };
const h3 = latLngToCell(point.lat, point.lng, 9);
const timeBandForHour = (hour) => {
  if (hour >= 5 && hour < 11) return { timeBand: 'Morning', representativeHour: 8 };
  if (hour >= 11 && hour < 17) return { timeBand: 'Afternoon', representativeHour: 14 };
  if (hour >= 17 && hour < 20) return { timeBand: 'Evening', representativeHour: 18 };
  return { timeBand: 'Night', representativeHour: 23 };
};
const score = async (hour) => {
  const incidents = await Incident.find({}).lean();
  const metadata = await Metadata.findOne({}).lean();
  const engine = createRiskEngine(incidents, {
    allCellCrime: metadata.percentileReferences?.[timeBandForHour(hour).timeBand] ?? metadata.percentileReference,
    allCellCrimeSorted: true,
    cityMeanCrime: metadata.cityMeanRisk,
  });
  const result = engine.scorePoint({ ...point, hour });
  const { timeBand } = timeBandForHour(hour);
  const stored = await CellRisk.findOne({ h3, band: timeBand }).lean();
  return { result, stored };
};

execFileSync('node', [path.resolve(process.cwd(), 'scripts/demoReset.js')], { stdio: 'inherit' });
await mongoose.connect(env.MONGODB_URI);
onCellsChanged(registerEdgeRiskRefresh());
try {
  await loadRoutingGraph({ mode: 'drive' });
} catch (error) {
  if (error.code === 'ENOENT') console.log('graph unavailable, edge refresh skipped');
  else throw error;
}
const hours = [1, 8, 10, 14, 18, 20, 22, 23];
const before = Object.fromEntries(await Promise.all(hours.map(async (hour) => [hour, await score(hour)])));
const metadata = await Metadata.findOne({}).lean();
const rows = csvSource.fetchRows({ filePath: path.resolve(process.cwd(), '../Data/demo_live_incidents.csv') });
const ingestion = await ingestRows(rows, { source: 'demo', deferMetadata: true });
const refresh = await refreshAffectedCells(ingestion.insertedIncidents);
await reload();
const after = { 22: await score(22), 23: await score(23) };
console.table(
  [22, 23].map((hour) => ({
    hour,
    baselineScore: before[hour].result.score,
    baselineLabel: before[hour].result.label,
    baselineConfidence: before[hour].result.confidence.toFixed(4),
    baselineNNearby: before[hour].result.nNearby,
    afterScore: after[hour].result.score,
    afterLabel: after[hour].result.label,
    afterConfidence: after[hour].result.confidence.toFixed(4),
    afterNNearby: after[hour].result.nNearby,
    affectedCells: refresh.affectedCells,
  })),
);
console.table(
  hours.map((hour) => {
    const { result } = before[hour];
    return {
      hour,
      ...timeBandForHour(hour),
      score: result.score,
      risk: result.risk.toFixed(6),
      C: result.crime.toFixed(6),
      E: result.environment.toFixed(6),
      confidence: result.confidence.toFixed(6),
      nNearby: result.nNearby,
    };
  }),
);
if ([22, 23].some((hour) => after[hour].result.score > before[hour].result.score)) {
  console.error('SafeScore increased after demo ingestion; inspect C, E, and shrinkage terms above.');
  process.exitCode = 1;
}
await mongoose.disconnect();

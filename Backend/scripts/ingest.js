import path from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { csvSource } from '../src/services/incidentSource.js';
import { ingestRows } from '../src/services/incidentIngestion.js';
import { refreshAffectedCells } from '../src/services/riskRefresh.js';
import { getDataFreshness } from '../src/services/dataFreshness.js';

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const sourceIndex = args.indexOf('--source');
const filePath = fileIndex >= 0 ? args[fileIndex + 1] : null;
const source = sourceIndex >= 0 ? args[sourceIndex + 1] : 'unknown';
const dryRun = args.includes('--dry-run');
const noRefresh = args.includes('--no-refresh');

if (!filePath) throw new Error('Usage: npm run ingest -- --file <path> --source <name> [--dry-run]');

const started = performance.now();
await mongoose.connect(env.MONGODB_URI);
const rows = csvSource.fetchRows({ filePath: path.resolve(process.cwd(), '..', filePath) });
const result = await ingestRows(rows, { source, dryRun, deferMetadata: !noRefresh });
const refresh = !dryRun && !noRefresh && result.insertedIncidents.length
  ? await refreshAffectedCells(result.insertedIncidents)
  : { affectedCells: 0, refreshedRecords: 0 };
const freshness = await getDataFreshness();
console.log(`input rows: ${result.inputRows}`);
console.log(`kept: ${result.kept}`);
console.log(`dropped by reason: ${JSON.stringify(result.droppedByReason)}`);
console.log(`inserted: ${dryRun ? 0 : result.inserted}`);
console.log(`duplicates: ${result.duplicates}`);
console.log(`excluded: ${result.excluded}`);
console.log(`affected H3 cells: ${refresh.affectedCells}`);
console.log(`refreshed CellRisk records: ${refresh.refreshedRecords}`);
console.log(`latestIncidentAt: ${freshness?.latestIncidentAt?.toISOString() ?? result.latestIncidentAt?.toISOString() ?? 'n/a'}`);
console.log(`dataVersion: ${freshness?.dataVersion ?? result.dataVersion ?? 'n/a'}`);
console.log(`elapsed: ${Math.round(performance.now() - started)}ms`);
console.log(`CellRisk refresh: ${noRefresh || dryRun ? 'not run (--no-refresh/dry-run)' : 'run'}`);
await mongoose.disconnect();

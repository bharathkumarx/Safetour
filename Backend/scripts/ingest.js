import path from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { csvSource } from '../src/services/incidentSource.js';
import { ingestRows } from '../src/services/incidentIngestion.js';
import { refreshAffectedCells } from '../src/services/riskRefresh.js';
import { getDataFreshness } from '../src/services/dataFreshness.js';
import { onCellsChanged } from '../src/services/riskEvents.js';
import { registerEdgeRiskRefresh } from '../src/services/edgeRiskRefresh.js';
import { loadRoutingGraph, graphInfo } from '../src/routing/graph.js';
import fs from 'node:fs/promises';

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
onCellsChanged(registerEdgeRiskRefresh());
let graphLoaded = false;
const graphStarted = performance.now();
try {
  await loadRoutingGraph({ mode: 'drive' });
  graphLoaded = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('graph unavailable, edge refresh skipped');
}
if (graphLoaded) {
  const info = graphInfo('drive');
  const graphPath = path.resolve(process.cwd(), '../Data/processed/blr_drive_graph.json');
  const riskPath = path.resolve(process.cwd(), '../Data/processed/blr_drive_edge_risk.bin');
  const [graphFile, riskFile] = await Promise.all([fs.stat(graphPath), fs.stat(riskPath)]);
  console.log(`graph facts: nodes ${info.nodes}, edges ${info.edges}, average edges per node ${(info.edges / info.nodes).toFixed(3)}, SCC ${info.sccSize}, nodes dropped ${info.nodesDropped}, graphVersion ${info.graphVersion}`);
  console.log(`graph load time: ${Math.round(performance.now() - graphStarted)}ms, heap used after loading: ${process.memoryUsage().heapUsed} bytes`);
  console.log(`graph files: topology ${graphFile.size} bytes, edge risk ${riskFile.size} bytes`);
  console.log('edge risk representation: JSON band values (not Float32 or Uint8); bytes per edge are approximate and include JSON keys/overhead');
}
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
const edgeResult = refresh.hookResults?.find((result) => result?.totalEdges !== undefined);
if (edgeResult) {
  console.log(`affected edges: ${edgeResult.refreshed} of ${edgeResult.totalEdges} (${((edgeResult.refreshed / edgeResult.totalEdges) * 100).toFixed(2)}%)`);
  console.log(`edge risk file updated: ${edgeResult.edgeRiskFileUpdated ? 'yes' : 'no'}`);
  console.log(`graphVersion: ${edgeResult.graphVersion}`);
} else if (graphLoaded) {
  console.log('affected edges: 0 of 0 (0%)');
  console.log('edge risk file updated: no');
  console.log('graphVersion: unavailable');
}
console.log(`latestIncidentAt: ${freshness?.latestIncidentAt?.toISOString() ?? result.latestIncidentAt?.toISOString() ?? 'n/a'}`);
console.log(`dataVersion: ${freshness?.dataVersion ?? result.dataVersion ?? 'n/a'}`);
console.log(`elapsed: ${Math.round(performance.now() - started)}ms`);
console.log(`CellRisk refresh: ${noRefresh || dryRun ? 'not run (--no-refresh/dry-run)' : 'run'}`);
await mongoose.disconnect();

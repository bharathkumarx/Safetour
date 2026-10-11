/**
 * captureSnapshot.js
 * Run from Backend/ to capture reference results before rewrite.
 * Output JSON is used by graphSnapshot.test.js.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { loadRoutingGraph, nearestNode, edgesForCells, edgeRisk, getGraph } from '../src/routing/graph.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const processedDir = path.join(repoRoot, 'Data/processed');
const outFile = path.resolve('tests/fixtures/graph_snapshot.json');

await loadRoutingGraph({
  mode: 'drive',
  graphPath: path.join(processedDir, 'blr_drive_graph.json'),
  riskPath: path.join(processedDir, 'blr_drive_edge_risk.bin'),
});

const g = getGraph('drive');
const allNodes = [...g.nodes.values()];
const allEdges = g.edges;

// 50 seeded nearestNode queries
const nearestResults = [];
let seed = 0xdeadbeef;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
for (let i = 0; i < 50; i++) {
  const lat = 12.82 + rng() * 0.34;
  const lng = 77.47 + rng() * 0.31;
  try {
    const { node, distanceMeters } = nearestNode(lat, lng, 'drive');
    nearestResults.push({ queryLat: lat, queryLng: lng, nodeId: String(node.id), nodeLat: node.lat, nodeLng: node.lng, distanceMeters });
  } catch {
    nearestResults.push({ queryLat: lat, queryLng: lng, error: 'NO_ROAD_NEARBY' });
  }
}

// edgesForCells for 50 seeded cells
const allCells = [...new Set(allEdges.flatMap((e) => e.cells || []))];
const cellSample = [];
for (let i = 0; i < 50; i++) {
  const idx = Math.floor(rng() * allCells.length);
  cellSample.push(allCells[idx]);
}
const edgesForCellsResults = cellSample.map((cell) => ({
  cell,
  edgeIds: edgesForCells([cell], 'drive').map((e) => e.id).sort(),
}));

// edgeRisk for 200 seeded (edge, band) pairs
const bands = ['Morning', 'Afternoon', 'Evening', 'Night'];
const edgeRiskResults = [];
for (let i = 0; i < 200; i++) {
  const edgeIdx = Math.floor(rng() * allEdges.length);
  const bandIdx = Math.floor(rng() * 4);
  const edge = allEdges[edgeIdx];
  const band = bands[bandIdx];
  const risk = edgeRisk(edge.id, band, 'drive');
  edgeRiskResults.push({ edgeId: edge.id, band, risk });
}

const snapshot = { nearestResults, edgesForCellsResults, edgeRiskResults };
await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify(snapshot, null, 2));
console.log(`Snapshot written to ${outFile}`);
console.log(`  nearestNode: ${nearestResults.length} queries`);
console.log(`  edgesForCells: ${edgesForCellsResults.length} cell queries`);
console.log(`  edgeRisk: ${edgeRiskResults.length} pairs`);

import { encodeBGraph, encodeBRiskFromBytes, decodeBRisk } from '../src/routing/graphBinary.js';
import { loadRoutingGraph, edgeRisk, getGraph, reloadEdgeRisk } from '../src/routing/graph.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, '..', 'tests', 'fixtures', 'debug-risk');
await fs.mkdir(fixtureDir, { recursive: true });

// Create simple graph: 2 nodes, 1 edge
const nodes = [
  { id: 'a', lat: 12.9, lng: 77.6 },
  { id: 'b', lat: 12.901, lng: 77.6 },
];
const edges = [
  { id: 'e1', from: 'a', to: 'b', length: 100, geometry: [{ lat: 12.9, lng: 77.6 }, { lat: 12.901, lng: 77.6 }], tags: { highway: 'residential' }, mode: 'drive' },
];

// Encode topology
const bgraphBuf = encodeBGraph({ nodes, edges, hash: 'testhash' });
const graphPath = path.join(fixtureDir, 'drive.bgraph');
await fs.writeFile(graphPath, bgraphBuf);

// Create risk bytes: 1 edge, 4 bands
// Morning (band 0) = 0.2 * 255 = 51
// Others = 128 (city-mean)
const edgeIds = ['e1'];
const riskBytes = new Uint8Array(4);
riskBytes[0] = 51;   // Morning = 0.2
riskBytes[1] = 128;  // Afternoon = 0.5
riskBytes[2] = 128;  // Evening = 0.5
riskBytes[3] = 128;  // Night = 0.5

const briskBuf = encodeBRiskFromBytes({ edgeIds, bytes: riskBytes, graphHash: 'testhash', riskSeq: 0, dataVersion: 'test' });
const riskPath = path.join(fixtureDir, 'drive.brisk');
await fs.writeFile(riskPath, briskBuf);

// Verify the .brisk file
const rawRisk = await fs.readFile(riskPath);
const decoded = decodeBRisk(rawRisk);
console.log('=== Decoded .brisk ===');
console.log('edgeCount:', decoded.edgeCount);
console.log('riskSeq:', decoded.riskSeq);
console.log('riskBytes:', Array.from(decoded.riskBytes));

// Load via graph.js
await loadRoutingGraph({ mode: 'drive', graphPath, riskPath });
const g = getGraph('drive');
console.log('\n=== Graph state ===');
console.log('edgeCount:', g.edgeCount);
console.log('edgeIds:', g.edgeIds);
console.log('riskBytes:', Array.from(g.riskBytes));

// Test edgeRisk
const risk = edgeRisk('e1', 'Morning', 'drive');
console.log('\n=== edgeRisk ===');
console.log('edgeRisk(e1, Morning):', risk);

// Test reloadEdgeRisk
await reloadEdgeRisk('drive', riskPath);
const g2 = getGraph('drive');
console.log('\n=== After reloadEdgeRisk ===');
console.log('riskBytes:', Array.from(g2.riskBytes));
console.log('graphVersion:', g2.graphVersion);
const risk2 = edgeRisk('e1', 'Morning', 'drive');
console.log('edgeRisk(e1, Morning):', risk2);
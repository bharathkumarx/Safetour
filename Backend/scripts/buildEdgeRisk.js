/**
 * buildEdgeRisk.js — canonical edge-risk rebuild.
 *
 * Recomputes ONLY the .brisk risk bytes for every mode from the current
 * CellRisk collection, reusing the EXACT topology already stored in
 * Data/processed/blr_<mode>.bgraph (no OSM re-fetch, no network). This is the
 * canonical way to fix a stale/flat .brisk and to bump riskSeq.
 *
 * Usage: npm run build:edge-risk
 * Run after: npm run build:risk
 *
 * Fails loudly (EDGE_RISK_NO_CELLRISK) if CellRisk is empty — never emits a
 * silent all-city-mean .brisk.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Metadata } from '../src/models/CellRisk.js';
import { decodeBGraph } from '../src/routing/graphBinary.js';
import {
  decodeCellRiskMap, computeEdgeRiskBytes, cityMeanByte,
  CITY_MEAN_FALLBACK_RISK, edgesFromBgraph,
} from '../src/routing/edgeRisk.js';
import { encodeBRiskFromBytes, makeGraphVersion, parseGraphVersion } from '../src/routing/graphBinary.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultOutputDir = path.join(repoRoot, 'Data/processed');
const MODES = ['drive', 'walk'];

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const CellRisk = (await import('../src/models/CellRisk.js')).CellRisk;
  const cellRisks = await CellRisk.find({}).select('h3 band risk').lean();
  const cellRiskMap = decodeCellRiskMap(cellRisks);
  if (cellRiskMap.size === 0) {
    console.error('[build:edge-risk] EDGE_RISK_NO_CELLRISK: CellRisk collection is empty; aborting (run build:risk first).');
    await mongoose.disconnect();
    process.exit(1);
  }
  const metadata = await Metadata.findOne({}).lean();
  const cityMeanRisk = metadata?.cityMeanRisk ?? CITY_MEAN_FALLBACK_RISK;
  const dataVersion = metadata?.dataVersion || '';
  const meanByte = cityMeanByte(cityMeanRisk);
  const nextGraphVersions = [];

  for (const mode of MODES) {
    const bgraphPath = path.join(defaultOutputDir, `blr_${mode}.bgraph`);
    const briskPath = path.join(defaultOutputDir, `blr_${mode}.brisk`);
    const graphBuf = await fs.readFile(bgraphPath);
    const decoded = decodeBGraph(graphBuf);
    const edges = edgesFromBgraph(decoded);
    const { bytes, fallbackBandCount, fallbackEdgeCount } = computeEdgeRiskBytes(edges, cellRiskMap, cityMeanRisk);
    // Validate byte count against topology.
    if (bytes.length !== decoded.edgeCount * 4) {
      console.error(`[build:edge-risk] ${mode}: byte count ${bytes.length} != ${decoded.edgeCount * 4}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    const prev = parseGraphVersion(metadata?.graphVersion || '');
    const seq = (prev.seq || 0) + 1;
    const briskBuf = encodeBRiskFromBytes({ edgeIds: decoded.edgeIds, bytes, graphHash: decoded.hash, riskSeq: seq, dataVersion });
    await fs.writeFile(`${briskPath}.next`, briskBuf);
    await fs.rename(`${briskPath}.next`, briskPath);
    const cityMeanCells = fallbackBandCount / (decoded.edgeCount * 4);
    console.log(`[build:edge-risk] ${mode}: edges=${decoded.edgeCount} seq=${seq} fallbackEdges=${fallbackEdgeCount} fallbackBands=${fallbackBandCount} (${(cityMeanCells * 100).toFixed(2)}% city-mean) -> ${briskPath}`);
    nextGraphVersions.push(makeGraphVersion(decoded.hash, seq));
  }

  await Metadata.updateOne({}, { $set: { graphVersion: nextGraphVersions.join(','), dataVersion } });
  await mongoose.disconnect();
  console.log(`[build:edge-risk] metadata.graphVersion set to ${nextGraphVersions.join(',')}`);
}

main().catch((error) => { console.error('[build:edge-risk]', error); process.exit(1); });

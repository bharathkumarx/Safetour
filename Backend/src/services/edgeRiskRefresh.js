import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Metadata } from '../models/CellRisk.js';
import { CellRisk } from '../models/CellRisk.js';
import { getDataStore } from './dataStore.js';
import { edgesForCells, getGraph } from '../routing/graph.js';
import { encodeBRisk, parseGraphVersion } from '../routing/graphBinary.js';

const bands = ['Morning', 'Afternoon', 'Evening', 'Night'];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultArtifactDir = path.join(repoRoot, 'Data/processed');

/** Refresh only edges touching affected H3 cells, preserving unaffected risk values. */
export async function refreshEdgeRisks(cellIds = [], { mode = 'drive', outputPath = path.join(defaultArtifactDir, `blr_${mode}_edge_risk.bin`) } = {}) {
  const store = getDataStore(); const graph = store.routing?.[mode] || getGraph(mode) || store.routing;
  if (!graph) return { refreshed: 0 };
  const edges = cellIds.length ? edgesForCells(cellIds, mode) : graph.edges;
  const currentRisks = await CellRisk.find(cellIds.length ? { h3: { $in: cellIds } } : {}).select('h3 band risk').lean();
  const riskMap = new Map(currentRisks.map((risk) => [`${risk.h3}:${risk.band}`, risk]));
  const target = path.resolve(outputPath); let risks = {};
  try { risks = JSON.parse((await fs.readFile(target)).toString('utf8')).risks || {}; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const cityMean = store.metadata?.cityMeanRisk ?? 0.5;
  let fallbackCount = 0;
  // Keep a complete risk matrix in every artifact. This is important when a
  // first incremental refresh follows a topology build with no prior brisk.
  for (const edge of graph.edges) {
    if (!risks[edge.id]) risks[edge.id] = {};
    for (const band of bands) if (risks[edge.id][band] == null) {
      risks[edge.id][band] = cityMean;
      fallbackCount += 1;
    }
  }
  for (const edge of edges) {
    risks[edge.id] = {};
    for (const band of bands) {
      let total = 0; let weight = 0;
      for (const cell of edge.cells) {
        const value = riskMap.get(`${cell}:${band}`) ?? store.cellRisks.get(`${cell}:${band}`);
        const cellWeight = edge.cellWeights?.[cell] || 1;
        if (value) { total += value.risk * cellWeight; weight += cellWeight; }
      }
      if (!weight) fallbackCount += 1;
      risks[edge.id][band] = weight ? total / weight : cityMean;
    }
  }
  const metadata = await Metadata.findOne({}).lean();
  // graphVersion: <topologyHash>:<seq+1>
  const prevGv = metadata?.graphVersion || graph.graphVersion || '0000000000000000:0';
  const { hash, seq } = parseGraphVersion(prevGv);
  const newSeq = seq + 1;
  const graphVersion = `${hash}:${newSeq}`;

  await fs.mkdir(path.dirname(target), { recursive: true });
  // Write legacy JSON (for backward compat)
  await fs.writeFile(`${target}.next`, JSON.stringify({ graphVersion, risks }));
  await fs.rename(`${target}.next`, target);

  // Write binary .brisk alongside
  const briskPath = target.endsWith('_edge_risk.bin')
    ? target.replace(/_edge_risk\.bin$/, '.brisk')
    : `${target}.brisk`;
  const edgeIds = graph.edges.map((e) => e.id);
  const briskBuf = encodeBRisk({ edgeIds, risks, graphHash: hash, riskSeq: newSeq, dataVersion: metadata?.dataVersion || '' });
  await fs.writeFile(`${briskPath}.next`, briskBuf);
  await fs.rename(`${briskPath}.next`, briskPath);

  await Metadata.updateOne({}, { $set: { graphVersion } });
  return { refreshed: edges.length, totalEdges: graph.edges.length, fallbackCount, graphVersion, edgeRiskFileUpdated: true };
}

export function registerEdgeRiskRefresh() { return (cells) => refreshEdgeRisks(cells); }

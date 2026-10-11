import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Metadata, CellRisk } from '../models/CellRisk.js';
import { getDataStore } from './dataStore.js';
import { edgesForCells, getGraph, sampleCells } from '../routing/graph.js';
import { decodeBRisk, encodeBRiskFromBytes, parseGraphVersion } from '../routing/graphBinary.js';
import { decodeCellRiskMap, patchRiskBytes, cityMeanByte, CITY_MEAN_FALLBACK_RISK } from '../routing/edgeRisk.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultArtifactDir = path.join(repoRoot, 'Data/processed');

/** Refresh only edges touching affected H3 cells, preserving unaffected risk values. */
export async function refreshEdgeRisks(cellIds = [], { mode = 'drive', outputPath = path.join(defaultArtifactDir, `blr_${mode}.brisk`) } = {}) {
  const store = getDataStore();
  const graph = store.routing?.[mode] || getGraph(mode) || store.routing;
  if (!graph) return { refreshed: 0 };

  const target = path.resolve(outputPath);
  const briskPath = target.endsWith('.brisk') ? target : target.replace(/(_edge_risk\.bin|\.json)$/, '.brisk');

  // Load prior .brisk risk bytes if available
  let riskBytes;
  let prevSeq = 0;
  let graphHash = graph.hash || '0000000000000000';
  try {
    const raw = await fs.readFile(briskPath);
    const decoded = decodeBRisk(raw);
    riskBytes = new Uint8Array(decoded.riskBytes);
    prevSeq = decoded.riskSeq ?? 0;
    if (decoded.graphHash) graphHash = decoded.graphHash;
  } catch {
    riskBytes = new Uint8Array(graph.edgeCount * 4).fill(cityMeanByte(store.metadata?.cityMeanRisk ?? CITY_MEAN_FALLBACK_RISK));
  }

  // Load all CellRisk entries or only affected cell entries
  const currentCellRisks = await CellRisk.find({}).select('h3 band risk').lean();
  const cellRiskMap = decodeCellRiskMap(currentCellRisks);
  if (cellRiskMap.size === 0) {
    throw new Error('EDGE_RISK_NO_CELLRISK: CellRisk is empty; refusing to update edge risks');
  }

  const affectedEdges = cellIds.length ? edgesForCells(cellIds, mode) : graph.edges;
  const edgeDescriptors = affectedEdges.map((e) => {
    const serial = e.serial ?? (graph.edgeSerialMap?.get(e.id) ?? graph.edgeIds.indexOf(e.id));
    const geometry = graph.getEdgeGeometry ? graph.getEdgeGeometry(serial) : e.geometry;
    const { cells, weights } = geometry ? sampleCells(geometry) : { cells: e.cells || [], weights: e.cellWeights || null };
    return { serial, id: e.id, cells, cellWeights: weights };
  });

  const cityMeanRisk = store.metadata?.cityMeanRisk ?? CITY_MEAN_FALLBACK_RISK;
  const { fallbackBandCount } = patchRiskBytes(edgeDescriptors, cellRiskMap, cityMeanRisk, riskBytes);

  const metadata = await Metadata.findOne({}).lean();
  const newSeq = prevSeq + 1;
  const graphVersion = `${graphHash}:${newSeq}`;

  const briskBuf = encodeBRiskFromBytes({
    edgeIds: graph.edgeIds,
    bytes: riskBytes,
    graphHash,
    riskSeq: newSeq,
    dataVersion: metadata?.dataVersion || store.metadata?.dataVersion || '',
  });

  await fs.mkdir(path.dirname(briskPath), { recursive: true });
  await fs.writeFile(`${briskPath}.next`, briskBuf);
  await fs.rename(`${briskPath}.next`, briskPath);

  // Update in-memory graph riskBytes if loaded
  if (graph.riskBytes && graph.riskBytes.length === riskBytes.length) {
    graph.riskBytes.set(riskBytes);
    if (graph.graphVersion !== undefined) graph.graphVersion = graphVersion;
  }

  await Metadata.updateOne({}, { $set: { graphVersion } });
  return { refreshed: affectedEdges.length, totalEdges: graph.edgeCount, fallbackCount: fallbackBandCount, graphVersion, edgeRiskFileUpdated: true };
}

export function registerEdgeRiskRefresh() { return (cells) => refreshEdgeRisks(cells); }

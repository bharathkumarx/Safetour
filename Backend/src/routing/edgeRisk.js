/**
 * edgeRisk.js — canonical, length-weighted edge-risk computation shared by
 * `build:graph`, `build:edge-risk`, and the incremental `refreshEdgeRisks`.
 *
 * A single source of truth avoids the historical bug where the binary `.brisk`
 * (served at runtime) and the legacy `.bin` mirror drifted, and where an empty
 * CellRisk collection silently produced a flat (all city-mean) `.brisk`.
 *
 * Risk is stored as 4 bytes per edge in BANDS order [Morning, Afternoon, Evening,
 * Night]. Every edge is length-weighted over the H3 cells its geometry crosses,
 * using the same `sampleCells` geometry sampler used to build the topology, so
 * the binary-recompute path reproduces an offline full build bit-for-bit.
 */
import { BANDS } from './graphBinary.js';
import { sampleCells } from './graph.js';

export { BANDS };

export const CITY_MEAN_FALLBACK_RISK = 0.5;

/** Quantize a 0..1 risk to a Uint8 byte (0..255), mirroring `encodeBRisk`. */
export function roundByte(value) {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** Byte representing city-mean shrinkage fallback for a given cityMeanRisk. */
export function cityMeanByte(cityMeanRisk = CITY_MEAN_FALLBACK_RISK) {
  return roundByte(cityMeanRisk);
}

/**
 * Length-weighted risk byte for a single (edge, band) pair.
 * Returns the byte and whether the edge fell back to city-mean (no cell covered).
 */
export function edgeBandByte(cellRiskMap, cells, cellWeights, band, cityMeanRisk) {
  let total = 0;
  let weight = 0;
  for (const cell of cells) {
    const value = cellRiskMap.get(`${cell}:${band}`);
    const w = (cellWeights && cellWeights[cell]) || 1;
    if (value !== undefined) {
      total += value * w;
      weight += w;
    }
  }
  if (weight === 0) return { byte: cityMeanByte(cityMeanRisk), fellBack: true };
  const v = Math.min(1, Math.max(0, total / weight));
  return { byte: roundByte(v), fellBack: false };
}

/**
 * Write risk bytes for a subset of edges into a pre-allocated buffer (mutates in
 * place). Used both by the full offline builder (`computeEdgeRiskBytes`) and by
 * the incremental refresh (`refreshEdgeRisks`), so all code paths share one
 * length-weighted sampler and produce identical bytes for matching cells.
 *
 * @param {Array<{serial:number, cells:string[], cellWeights?:Object}>} edges
 * @param {Map<string, number>} cellRiskMap
 * @param {number} cityMeanRisk
 * @param {Uint8Array} outBytes  length edgeCount*4; only provided edges overwritten
 * @returns {{fallbackBandCount: number}}
 */
export function patchRiskBytes(edges, cellRiskMap, cityMeanRisk, outBytes) {
  if (!cellRiskMap || cellRiskMap.size === 0) {
    throw new Error('EDGE_RISK_NO_CELLRISK: CellRisk is empty; refusing to emit a flat edge-risk file');
  }
  let fallbackBandCount = 0;
  for (const edge of edges) {
    for (let b = 0; b < BANDS.length; b++) {
      const { byte, fellBack } = edgeBandByte(cellRiskMap, edge.cells, edge.cellWeights, BANDS[b], cityMeanRisk);
      outBytes[edge.serial * 4 + b] = byte;
      if (fellBack) fallbackBandCount += 1;
    }
  }
  return { fallbackBandCount };
}

/**
 * Compute risk bytes for a set of edges.
 *
 * @param {Array<{serial:number, cells:string[], cellWeights?:Object}>} edges
 * @param {Map<string, number>} cellRiskMap  Map of `${h3}:${band}` -> risk (0..1)
 * @param {number} [cityMeanRisk=0.5]
 * @param {Uint8Array|null} [outBytes=null]  Pre-allocated `edgeCount*4` buffer to
 *   write into (used by incremental refresh to preserve unaffected edge bytes).
 * @returns {{bytes: Uint8Array, fallbackEdgeCount: number, fallbackBandCount: number}}
 * @throws {Error} EDGE_RISK_NO_CELLRISK when cellRiskMap is empty (never silent-flat).
 */
export function computeEdgeRiskBytes(edges, cellRiskMap, cityMeanRisk = CITY_MEAN_FALLBACK_RISK, outBytes = null) {
  if (!cellRiskMap || cellRiskMap.size === 0) {
    throw new Error('EDGE_RISK_NO_CELLRISK: CellRisk is empty; refusing to emit a flat edge-risk file');
  }
  const bytes = outBytes ?? new Uint8Array(edges.length * 4);
  let fallbackEdgeCount = 0;
  let fallbackBandCount = 0;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const serial = edge.serial ?? i;
    let fellBackAll = true;
    for (let b = 0; b < BANDS.length; b++) {
      const { byte, fellBack } = edgeBandByte(cellRiskMap, edge.cells, edge.cellWeights, BANDS[b], cityMeanRisk);
      bytes[serial * 4 + b] = byte;
      if (fellBack) fallbackBandCount += 1;
      else fellBackAll = false;
    }
    if (fellBackAll) fallbackEdgeCount += 1;
  }
  return { bytes, fallbackEdgeCount, fallbackBandCount };
}

/**
 * Build length-weighted edge descriptors from a decoded `.bgraph`.
 * Recomputes cells + weights via `sampleCells` on each edge's geometry so the
 * result is identical to what `buildRoutingGraph` produced (and which
 * `build:graph` encodes into the topology).
 */
export function edgesFromBgraph(decoded) {
  const n = decoded.edgeCount;
  const edges = new Array(n);
  for (let i = 0; i < n; i++) {
    const geometry = decoded.getEdgeGeometry(i);
    const { cells, weights } = sampleCells(geometry);
    edges[i] = { serial: i, id: decoded.edgeIds[i], cells, cellWeights: weights };
  }
  return edges;
}

/** Decode an array of CellRisk docs {h3, band, risk} into a lookup Map. */
export function decodeCellRiskMap(docs) {
  const map = new Map();
  for (const doc of docs) {
    if (doc && doc.h3 != null && doc.band && doc.risk != null) map.set(`${doc.h3}:${doc.band}`, doc.risk);
  }
  return map;
}

/**
 * Per-band byte statistics for a risk buffer.
 * @param {number} edgeCount
 * @param {Uint8Array} bytes  length edgeCount*4
 * @param {number} cityMeanByteValue  byte that represents city-mean fallback
 * @param {Uint32Array|null} [edgeCellLen=null]  per-edge cell count (for zero-cell count)
 */
export function computeRiskStats(edgeCount, bytes, cityMeanByteValue, edgeCellLen = null) {
  const perBand = [];
  for (let b = 0; b < BANDS.length; b++) {
    const vals = new Uint8Array(edgeCount);
    let countCityMean = 0;
    for (let i = 0; i < edgeCount; i++) {
      const v = bytes[i * 4 + b];
      vals[i] = v;
      if (v === cityMeanByteValue) countCityMean += 1;
    }
    const sorted = Uint8Array.from(vals).sort((a, c) => a - c);
    const distinct = new Set(vals).size;
    const pct = (p) => sorted[Math.min(edgeCount - 1, Math.max(0, Math.floor((p / 100) * (edgeCount - 1))))];
    perBand.push({ band: BANDS[b], min: sorted[0], p10: pct(10), median: pct(50), p90: pct(90), max: sorted[edgeCount - 1], distinct, countCityMean });
  }
  let zeroCellEdges = null;
  if (edgeCellLen) {
    zeroCellEdges = 0;
    for (let i = 0; i < edgeCount; i++) if (edgeCellLen[i] === 0) zeroCellEdges += 1;
  }
  return { perBand, zeroCellEdges };
}

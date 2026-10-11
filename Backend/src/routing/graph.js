/**
 * graph.js — Routing graph: load, query, and edge-risk APIs.
 *
 * Public API (unchanged):
 *   getGraph(mode)           → internal state object (for router/dataStore)
 *   nearestNode(lat,lng,mode)→ { node, distanceMeters }
 *   getEdge(edgeId, mode)    → edge-like object (lazy geometry decoded)
 *   edgeRisk(edgeId,band,mode)→ number 0-1
 *   reloadEdgeRisk(mode,path) → Promise<state>
 *   edgesForCells(cells,mode) → edge-like objects[]
 *   graphInfo(mode)          → { mode,graphVersion,nodes,edges,sccSize,nodesDropped }
 *   getAdjacency(mode)       → { offsets, targets, edgeIds } CSR Uint32Arrays
 *   bands                    → string[]
 *
 * Internal formats: .bgraph (topology) + .brisk (edge risk).
 * Falls back to legacy JSON if the binary files are absent (for test fixtures).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import KDBush from 'kdbush';
import { latLngToCell } from 'h3-js';
import {
  decodeBGraph, decodeBRisk, bsearchBigUint64, makeGraphVersion, parseGraphVersion,
  topologyHash, BANDS,
} from './graphBinary.js';

export { BANDS as bands };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultArtifactDir = path.join(repoRoot, 'Data/processed');
const R = Math.PI / 180;

/** Haversine distance in metres between two {lat,lng} objects. */
export const haversine = (a, b) => {
  const dLat = (b.lat - a.lat) * R; const dLng = (b.lng - a.lng) * R;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

function direction(way) {
  if (way.mode === 'walk') return 0;
  const one = way.tags?.oneway;
  if (way.tags?.junction === 'roundabout' || one === 'yes' || one === '1') return 1;
  if (one === '-1') return -1;
  return 0;
}

/** Collapse degree-two non-intersection nodes into geometry edges. Used by buildRoutingGraph and tests. */
export function buildRoutingGraph({ nodes = [], ways = [] } = {}) {
  const nodeMap = new Map(nodes.map((n) => [String(n.id), n]));
  const degree = new Map();
  for (const way of ways) for (const id of way.nodes) degree.set(id, (degree.get(id) || 0) + 1);
  const edges = []; const edgeById = new Map();
  for (const way of ways) {
    const refs = direction(way) === -1 ? [...way.nodes].reverse() : way.nodes;
    let start = refs[0]; let geometry = [nodeMap.get(start)];
    for (let i = 1; i < refs.length; i += 1) {
      const id = refs[i]; geometry.push(nodeMap.get(id));
      if (i === refs.length - 1 || degree.get(id) !== 2) {
        const from = geometry[0]; const to = geometry[geometry.length - 1];
        if (!from || !to) { start = id; geometry = [nodeMap.get(id)]; continue; }
        const length = geometry.slice(1).reduce((sum, point, j) => sum + haversine(geometry[j], point), 0);
        const sampled = sampleCells(geometry);
        const edge = { id: `${way.id}:${start}:${id}`, from: String(from.id), to: String(to.id), length, geometry, cells: sampled.cells, cellWeights: sampled.weights, tags: way.tags || {}, mode: way.mode || 'drive' };
        edges.push(edge); edgeById.set(edge.id, edge);
        if (direction(way) === 0 && edge.from !== edge.to) {
          const reverse = { ...edge, id: `${edge.id}:r`, from: edge.to, to: edge.from, geometry: [...geometry].reverse() };
          edges.push(reverse); edgeById.set(reverse.id, reverse);
        }
        start = id; geometry = [nodeMap.get(id)];
      }
    }
  }
  return { edges, edgeById, nodes: nodeMap };
}

/** Sample H3 cells (length-weighted) along a polyline geometry. Exported for the
 * edge-risk builders so the binary path reproduces an offline full build exactly.
 */
export function sampleCells(geometry) {
  const cells = new Set(); const weights = {}; let carry = 0;
  for (let i = 1; i < geometry.length; i += 1) {
    const a = geometry[i - 1]; const b = geometry[i]; const length = haversine(a, b); const count = Math.max(1, Math.ceil((carry + length) / 50));
    for (let j = 0; j <= count; j += 1) {
      const t = j / count; const cell = latLngToCell(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t, 9);
      cells.add(cell); weights[cell] = (weights[cell] || 0) + length / count;
    }
    carry = (carry + length) % 50;
  }
  return { cells: [...cells], weights };
}

// ── Per-mode state ─────────────────────────────────────────────────────────────
/** @type {Record<string, import('./graphTypes.js').GraphState>} */
const state = { drive: null, walk: null };

/**
 * Build a KDBush index over node lat/lng for fast nearest-node queries.
 * @param {Float64Array} lats
 * @param {Float64Array} lngs
 * @returns {KDBush}
 */
function buildNodeIndex(lats, lngs) {
  const index = new KDBush(lats.length);
  for (let i = 0; i < lats.length; i++) index.add(lngs[i], lats[i]); // KDBush: x=lng, y=lat
  index.finish();
  return index;
}

/**
 * Load risk from a .brisk buffer into a Uint8Array keyed by edge serial.
 * @param {Buffer} riskBuf
 * @param {number} edgeCount
 * @returns {{ riskBytes: Uint8Array, graphHash: string, riskSeq: number }}
 */
function loadBRisk(riskBuf, edgeCount) {
  try {
    const decoded = decodeBRisk(riskBuf);
    if (decoded.edgeCount !== edgeCount) {
      // mismatch — return neutral risk
      return { riskBytes: new Uint8Array(edgeCount * 4).fill(128), graphHash: '', riskSeq: 0 };
    }
    return { riskBytes: decoded.riskBytes, graphHash: decoded.graphHash, riskSeq: decoded.riskSeq };
  } catch {
    return { riskBytes: new Uint8Array(edgeCount * 4).fill(128), graphHash: '', riskSeq: 0 };
  }
}

/**
 * Parse legacy JSON edge risk into a Uint8Array in canonical BANDS order.
 * @param {object} risksObj - { edgeId: { band: number } }
 * @param {string[]} edgeIds - canonical edge ID order
 */
function legacyRiskToBytes(risksObj, edgeIds) {
  const bytes = new Uint8Array(edgeIds.length * 4);
  bytes.fill(128); // 0.5 default
  for (let i = 0; i < edgeIds.length; i++) {
    const r = risksObj[edgeIds[i]];
    if (!r) continue;
    for (let b = 0; b < 4; b++) {
      const v = r[BANDS[b]] ?? 0.5;
      bytes[i * 4 + b] = Math.min(255, Math.max(0, Math.round(v * 255)));
    }
  }
  return bytes;
}

/**
 * Construct state from a decoded .bgraph + risk bytes.
 */
function buildState(decoded, riskBytes, graphVersion, sccSize, nodesDropped) {
  const { nodeCount, edgeCount, hash,
    nodeLats, nodeLngs, nodeIds, edgeIds,
    edgeFrom, edgeTo, edgeLengthM, edgeHwClass,
    edgeGeomOff, edgeGeomLen, edgeCellOff, edgeCellLen,
    cellPool, csrSortedCells, csrOffsets, csrEdgeIds,
    getEdgeGeometry, getEdgeCells } = decoded;

  // KDBush node index
  const nodeIndex = buildNodeIndex(nodeLats, nodeLngs);

  // Edge serial lookup: edgeId string → serial index
  const edgeSerialMap = new Map(edgeIds.map((id, i) => [id, i]));
  // Node serial lookup: nodeId string → serial index
  const nodeSerialMap = new Map(nodeIds.map((id, i) => [id, i]));

  // Build CSR adjacency (forward edges from each node)
  // For each node, list outgoing edge indices
  const nodeOutDeg = new Uint32Array(nodeCount);
  for (let i = 0; i < edgeCount; i++) nodeOutDeg[edgeFrom[i]]++;
  const adjOffsets = new Uint32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) adjOffsets[i + 1] = adjOffsets[i] + nodeOutDeg[i];
  const adjTargets = new Uint32Array(adjOffsets[nodeCount]);
  const adjEdgeIds = new Uint32Array(adjOffsets[nodeCount]);
  const adjPos = adjOffsets.slice(0, nodeCount);
  for (let i = 0; i < edgeCount; i++) {
    const src = edgeFrom[i];
    const slot = adjPos[src]++;
    adjTargets[slot] = edgeTo[i];
    adjEdgeIds[slot] = i;
  }

  return {
    // typed arrays (zero-copy reads after decode)
    nodeLats, nodeLngs, nodeIds, nodeCount,
    edgeFrom, edgeTo, edgeLengthM, edgeHwClass,
    edgeGeomOff, edgeGeomLen, edgeCellOff, edgeCellLen,
    edgeIds, edgeCount,
    cellPool, csrSortedCells, csrOffsets, csrEdgeIds,
    riskBytes,
    // indices
    nodeIndex, edgeSerialMap, nodeSerialMap,
    adjOffsets, adjTargets, adjEdgeIds,
    // helpers
    getEdgeGeometry, getEdgeCells,
    // metadata
    graphVersion, hash,
    sccSize: sccSize ?? nodeCount,
    nodesDropped: nodesDropped ?? 0,
    // compatibility: expose `.nodes` as a Map and `.edges` as array (for dataStore/edgeRiskRefresh)
    get nodes() { return _nodeLazyMap(this); },
    get edges() { return _edgeLazyArr(this); },
    get edgeById() { return _edgeByIdMap(this); },
    get risks() { return _risksLazy(this); },
    _nodesMap: null, _edgesArr: null, _edgeByIdMap: null, _risksObj: null,
  };
}

/** Lazy node Map (built once, cached). */
function _nodeLazyMap(st) {
  if (!st._nodesMap) {
    st._nodesMap = new Map();
    for (let i = 0; i < st.nodeCount; i++) {
      const id = st.nodeIds[i];
      st._nodesMap.set(id, { id, lat: st.nodeLats[i], lng: st.nodeLngs[i] });
    }
  }
  return st._nodesMap;
}

/** Lazy edges array (built once, cached). */
function _edgeLazyArr(st) {
  if (!st._edgesArr) {
    st._edgesArr = Array.from({ length: st.edgeCount }, (_, i) => _edgeAt(st, i));
  }
  return st._edgesArr;
}

/** Lazy edgeById Map. */
function _edgeByIdMap(st) {
  if (!st._edgeByIdMap) {
    st._edgeByIdMap = new Map();
    for (let i = 0; i < st.edgeCount; i++) st._edgeByIdMap.set(st.edgeIds[i], _edgeAt(st, i));
  }
  return st._edgeByIdMap;
}

/** Lazy risks object (for legacy callers). */
function _risksLazy(st) {
  if (!st._risksObj) {
    st._risksObj = new Proxy({}, {
      get(_, edgeId) {
        const i = st.edgeSerialMap.get(edgeId);
        if (i === undefined) return undefined;
        const obj = {};
        for (let b = 0; b < 4; b++) obj[BANDS[b]] = st.riskBytes[i * 4 + b] / 255;
        return obj;
      },
      has(_, edgeId) { return st.edgeSerialMap.has(edgeId); },
    });
  }
  return st._risksObj;
}

/** Build a single edge-like object for external consumers (geometry decoded lazily). */
function _edgeAt(st, i) {
  let _geometry = null;
  let _cells = null;
  return {
    get id() { return st.edgeIds[i]; },
    get from() { return st.nodeIds[st.edgeFrom[i]]; },
    get to() { return st.nodeIds[st.edgeTo[i]]; },
    get length() { return st.edgeLengthM[i]; },
    get geometry() { return (_geometry ??= st.getEdgeGeometry(i)); },
    get cells() { return (_cells ??= st.getEdgeCells(i)); },
    get cellWeights() { return null; }, // not stored; callers fall back to uniform weight
    get tags() { return {}; },
    get mode() { return 'drive'; },
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Load a mode graph from binary (.bgraph + .brisk) or legacy JSON files. */
export async function loadRoutingGraph({
  mode = 'drive',
  graphPath = path.join(defaultArtifactDir, `blr_${mode}.bgraph`),
  riskPath = path.join(defaultArtifactDir, `blr_${mode}.brisk`),
} = {}) {
  // ── If caller passes a JSON path explicitly (e.g. tests), go straight to legacy ──
  if (graphPath.endsWith('.json')) {
    return _loadLegacyJson(mode, graphPath, riskPath);
  }

  // ── Try binary .bgraph first ───────────────────────────────────────────────
  const binaryExists = await fs.access(graphPath).then(() => true).catch(() => false);
  if (binaryExists) {
    const [graphBuf, riskBuf] = await Promise.all([fs.readFile(graphPath), fs.readFile(riskPath).catch(() => null)]);
    let decoded;
    try { decoded = decodeBGraph(graphBuf); } catch {
      // file exists but isn't binary (e.g. leftover JSON at .bgraph path) — fall through
      return _loadLegacyJson(mode, graphPath, riskPath);
    }
    const { riskBytes, riskSeq } = riskBuf ? loadBRisk(riskBuf, decoded.edgeCount) : { riskBytes: new Uint8Array(decoded.edgeCount * 4).fill(128), riskSeq: 0 };
    const gv = makeGraphVersion(decoded.hash, riskSeq);
    state[mode] = buildState(decoded, riskBytes, gv, decoded.edgeCount, 0);
    return state[mode];
  }

  // ── Legacy JSON fallback (for backward compat with old JSON artifacts) ────
  const legacyGraphPath = graphPath.replace(/\.bgraph$/, '_graph.json');
  const legacyRiskPath = riskPath.replace ? riskPath.replace(/\.brisk$/, '_edge_risk.bin') : riskPath;
  const jsonExists = await fs.access(legacyGraphPath).then(() => true).catch(() => false);
  if (jsonExists) return _loadLegacyJson(mode, legacyGraphPath, legacyRiskPath);
  // Last resort: try the traditional default paths
  const origGraph = path.join(defaultArtifactDir, `blr_${mode}_graph.json`);
  const origRisk = path.join(defaultArtifactDir, `blr_${mode}_edge_risk.bin`);
  return _loadLegacyJson(mode, origGraph, origRisk);
}


async function _loadLegacyJson(mode, graphPath, riskPath) {
  const data = JSON.parse(await fs.readFile(graphPath, 'utf8'));
  let risksObj = {};
  try { risksObj = JSON.parse((await fs.readFile(riskPath)).toString('utf8')).risks || {}; } catch { /* ok */ }

  const built = data.edges
    ? (() => {
      const nodeMap = new Map(data.nodes.map((node) => [String(node.id), node]));
      const edgeById = new Map();
      for (const edge of data.edges) edgeById.set(edge.id, edge);
      return { edges: data.edges, edgeById, nodes: nodeMap };
    })()
    : buildRoutingGraph(data);

  const edgeIds = built.edges.map((e) => e.id);
  const nodeArr = [...built.nodes.values()];
  const hash = topologyHash(nodeArr.length, built.edges.length, edgeIds[0] || '');
  const riskBytes = legacyRiskToBytes(risksObj, edgeIds);

  // Build typed arrays from the JS objects
  const nodeCount = nodeArr.length;
  const edgeCount = built.edges.length;
  const nodeLats = new Float64Array(nodeCount);
  const nodeLngs = new Float64Array(nodeCount);
  const nodeIds = [];
  const nodeSerialMap = new Map();
  nodeArr.forEach((n, i) => {
    nodeLats[i] = n.lat; nodeLngs[i] = n.lng;
    nodeIds.push(String(n.id)); nodeSerialMap.set(String(n.id), i);
  });

  const edgeFrom = new Uint32Array(edgeCount);
  const edgeTo = new Uint32Array(edgeCount);
  const edgeLengthM = new Float32Array(edgeCount);
  const edgeHwClass = new Uint8Array(edgeCount);
  const edgeGeomCache = new Array(edgeCount);
  const edgeCellCache = new Array(edgeCount);
  const edgeSerialMap = new Map();
  for (let i = 0; i < edgeCount; i++) {
    const e = built.edges[i];
    edgeFrom[i] = nodeSerialMap.get(e.from) ?? 0;
    edgeTo[i] = nodeSerialMap.get(e.to) ?? 0;
    edgeLengthM[i] = e.length || 0;
    edgeGeomCache[i] = e.geometry;
    edgeCellCache[i] = e.cells;
    edgeSerialMap.set(e.id, i);
  }

  const getEdgeGeometry = (i) => edgeGeomCache[i] || [];
  const getEdgeCells = (i) => edgeCellCache[i] || [];

  // Minimal decoded-like object for buildState
  const decoded = {
    nodeCount, edgeCount, hash,
    nodeLats, nodeLngs, nodeIds,
    edgeFrom, edgeTo, edgeLengthM, edgeHwClass,
    edgeGeomOff: new Uint32Array(edgeCount),
    edgeGeomLen: new Uint32Array(edgeCount),
    edgeCellOff: new Uint32Array(edgeCount),
    edgeCellLen: new Uint16Array(edgeCount),
    edgeIds, cellPool: new BigUint64Array(0),
    csrSortedCells: new BigUint64Array(0),
    csrOffsets: new Uint32Array(1),
    csrEdgeIds: new Uint32Array(0),
    getEdgeGeometry, getEdgeCells,
  };

  // Build H3 cell lookup for edgesForCells: Map<cell, edgeIdx[]>
  const cellToEdges = new Map();
  for (let i = 0; i < edgeCount; i++) {
    for (const cell of edgeCellCache[i] || []) {
      if (!cellToEdges.has(cell)) cellToEdges.set(cell, []);
      cellToEdges.get(cell).push(i);
    }
  }

  const gv = makeGraphVersion(hash, 0);
  const st = buildState(decoded, riskBytes, data.graphVersion || gv,
    data.sccSize ?? nodeArr.length, data.nodesDropped ?? 0);
  // Attach legacy cell lookup for edgesForCells (binary format uses CSR)
  st._legacyCellMap = cellToEdges;
  // Override edgeSerialMap with the correctly computed one
  st.edgeSerialMap = edgeSerialMap;
  // Preserve original node/edge IDs
  st.nodeSerialMap = nodeSerialMap;
  state[mode] = st;
  return state[mode];
}

/** Reload only edge risk from .brisk (or legacy .bin). */
export const reloadEdgeRisk = async (
  mode = 'drive',
  riskPath = path.join(defaultArtifactDir, `blr_${mode}.brisk`),
) => {
  if (!state[mode]) return loadRoutingGraph({ mode });
  const st = state[mode];
  const briskExists = await fs.access(riskPath).then(() => true).catch(() => false);
  if (briskExists) {
    const riskBuf = await fs.readFile(riskPath);
    const { riskBytes, riskSeq } = loadBRisk(riskBuf, st.edgeCount);
    st.riskBytes = riskBytes;
    st.graphVersion = makeGraphVersion(st.hash, riskSeq);
    st._risksObj = null; // invalidate lazy proxy
    return st;
  }
  // Legacy JSON fallback
  const legacyRiskPath = path.join(defaultArtifactDir, `blr_${mode}_edge_risk.bin`);
  try {
    const risksObj = JSON.parse((await fs.readFile(legacyRiskPath)).toString('utf8')).risks || {};
    st.riskBytes = legacyRiskToBytes(risksObj, st.edgeIds);
    st._risksObj = null;
  } catch { /* no risk file, keep existing */ }
  return st;
};

export const getGraph = (mode = 'drive') => state[mode];

export const getEdge = (edgeId, mode = 'drive') => {
  const st = state[mode];
  if (!st) return undefined;
  const i = st.edgeSerialMap.get(edgeId);
  if (i === undefined) return undefined;
  return _edgeAt(st, i);
};

export const edgeRisk = (edgeId, band, mode = 'drive') => {
  const st = state[mode];
  if (!st) return 0.5;
  const i = st.edgeSerialMap.get(edgeId);
  if (i === undefined) return 0.5;
  const b = BANDS.indexOf(band);
  if (b < 0) return 0.5;
  return st.riskBytes[i * 4 + b] / 255;
};

export const edgesForCells = (cells, mode = 'drive') => {
  const st = state[mode];
  if (!st) return [];
  const cellSet = new Set(cells);
  const resultIdx = new Set();

  if (st._legacyCellMap) {
    // Legacy JSON path: use the string cell map
    for (const cell of cellSet) {
      const idxs = st._legacyCellMap.get(cell);
      if (idxs) for (const i of idxs) resultIdx.add(i);
    }
  } else {
    // Binary path: binary search in CSR index
    for (const cell of cellSet) {
      let cellBig;
      try { cellBig = BigInt(`0x${cell}`); } catch { continue; }
      const ci = bsearchBigUint64(st.csrSortedCells, cellBig);
      if (ci < 0) continue;
      for (let j = st.csrOffsets[ci]; j < st.csrOffsets[ci + 1]; j++) {
        resultIdx.add(st.csrEdgeIds[j]);
      }
    }
  }
  return [...resultIdx].map((i) => _edgeAt(st, i));
};

export function nearestNode(lat, lng, mode = 'drive') {
  const st = state[mode];
  if (!st) throw new Error('GRAPH_NOT_LOADED');
  // KDBush nearest: x=lng, y=lat; radius in degrees (~500 m ≈ 0.0045 deg)
  const results = st.nodeIndex.within(lng, lat, 0.0045); // ~500 m radius
  let best = -1; let bestDist = Infinity;
  for (const idx of results) {
    const d = haversine({ lat, lng }, { lat: st.nodeLats[idx], lng: st.nodeLngs[idx] });
    if (d < bestDist) { bestDist = d; best = idx; }
  }
  if (best < 0 || bestDist > 500) {
    // Expand search to full set if nothing within 500m radius
    if (results.length === 0) {
      // Expand to 5000 m
      const wide = st.nodeIndex.within(lng, lat, 0.045);
      for (const idx of wide) {
        const d = haversine({ lat, lng }, { lat: st.nodeLats[idx], lng: st.nodeLngs[idx] });
        if (d < bestDist) { bestDist = d; best = idx; }
      }
    }
    if (best < 0 || bestDist > 500) {
      const error = new Error('No road nearby');
      error.code = 'NO_ROAD_NEARBY';
      error.distanceMeters = bestDist === Infinity ? 9999 : bestDist;
      throw error;
    }
  }
  return { node: { id: st.nodeIds[best], lat: st.nodeLats[best], lng: st.nodeLngs[best] }, distanceMeters: bestDist };
}

export const graphInfo = (mode = 'drive') => {
  const st = state[mode];
  return st ? {
    mode,
    graphVersion: st.graphVersion,
    nodes: st.nodeCount,
    edges: st.edgeCount,
    sccSize: st.sccSize,
    nodesDropped: st.nodesDropped,
  } : null;
};

/** Expose CSR adjacency for the A* router (no ngraph). */
export const getAdjacency = (mode = 'drive') => {
  const st = state[mode];
  if (!st) return null;
  return { offsets: st.adjOffsets, targets: st.adjTargets, edgeIds: st.adjEdgeIds };
};

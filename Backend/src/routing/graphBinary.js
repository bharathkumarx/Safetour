/** Binary topology and edge-risk artifacts.
 *
 * The topology is a single, aligned ArrayBuffer.  The fixed section table is
 * deliberately boring: readers can validate offsets and create zero-copy
 * typed-array views without walking records or allocating per-edge objects.
 */
import crypto from 'node:crypto';

export const BANDS = ['Morning', 'Afternoon', 'Evening', 'Night'];
export const BGRAPH_MAGIC = 'BGRPH';
export const BRISK_MAGIC = 'BRISK';
const VERSION = 2;
const PREFIX = 40;
const ENTRY = 24;
const ALIGN = 8;
const TYPES = { INT32: 1, UINT32: 2, FLOAT32: 3, UINT8: 4, BIGUINT64: 5 };
const S = {
  NODE_LAT: 1, NODE_LNG: 2, NODE_ID: 3, EDGE_FROM: 4, EDGE_TO: 5, EDGE_LENGTH: 6,
  EDGE_HW: 7, EDGE_ID: 8, GEOM_OFF: 9, GEOM_POOL: 10, CELL_OFF: 11, CELL_POOL: 12,
  CSR_CELL: 13, CSR_OFF: 14, CSR_EDGE: 15,
};
const align = (n) => (n + 7) & ~7;
const asCell = (value) => BigInt(`0x${String(value).replace(/^0x/, '')}`);
const view = (buffer, offset, count, type) => {
  if (offset % (type.BYTES_PER_ELEMENT || 1)) throw new Error('unaligned topology section');
  return new type(buffer, offset, count);
};

/** Compute a stable topology hash. */
export function topologyHash(nodeCount, edgeCount, firstEdgeId = '') {
  return crypto.createHash('sha256').update(`${nodeCount}:${edgeCount}:${firstEdgeId}`).digest('hex').slice(0, 16);
}
export const makeGraphVersion = (hash, seq) => `${hash}:${seq}`;
export function parseGraphVersion(value = '') {
  const i = value.lastIndexOf(':');
  return i < 0 ? { hash: value, seq: 0 } : { hash: value.slice(0, i), seq: Number(value.slice(i + 1)) || 0 };
}

function numericId(value, fallback) {
  try {
    const n = BigInt(String(value));
    return n >= 0n ? n : BigInt(fallback);
  } catch { return BigInt(fallback); }
}

/** Encode graph topology into one aligned binary buffer. */
export function encodeBGraph({ nodes, edges, hash }) {
  const n = nodes.length; const e = edges.length;
  const nodeMap = new Map(nodes.map((x, i) => [String(x.id), i]));
  const nodeLat = new Int32Array(n); const nodeLng = new Int32Array(n); const nodeId = new BigUint64Array(n);
  nodes.forEach((x, i) => { nodeLat[i] = Math.round(x.lat * 1e6); nodeLng[i] = Math.round(x.lng * 1e6); nodeId[i] = numericId(x.id, i); });
  const from = new Uint32Array(e); const to = new Uint32Array(e); const length = new Float32Array(e);
  const hw = new Uint8Array(e); const edgeId = new BigUint64Array(e);
  const geomOff = new Uint32Array(e + 1); const cellOff = new Uint32Array(e + 1);
  const geom = []; const cells = [];
  const hwClasses = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified', 'living_street', 'footway', 'path', 'cycleway', 'steps'];
  for (let i = 0; i < e; i += 1) {
    const x = edges[i]; from[i] = nodeMap.get(String(x.from)) ?? 0xffffffff; to[i] = nodeMap.get(String(x.to)) ?? 0xffffffff;
    length[i] = x.length || 0; hw[i] = Math.max(0, hwClasses.indexOf(x.tags?.highway) + 1); edgeId[i] = numericId(x.id, i);
    geomOff[i] = geom.length / 2; for (const p of x.geometry || []) geom.push(Math.round(p.lat * 1e6), Math.round(p.lng * 1e6));
    cellOff[i] = cells.length; for (const c of [...new Set(x.cells || [])].sort()) cells.push(asCell(c));
  }
  geomOff[e] = geom.length / 2; cellOff[e] = cells.length;
  const unique = [...new Set(cells.map(String))].map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const index = new Map(unique.map((x, i) => [String(x), i])); const deg = new Uint32Array(unique.length);
  edges.forEach((x) => [...new Set((x.cells || []).map(asCell).map(String))].forEach((c) => { deg[index.get(c)] += 1; }));
  const csrOff = new Uint32Array(unique.length + 1); for (let i = 0; i < unique.length; i++) csrOff[i + 1] = csrOff[i] + deg[i];
  const csrEdge = new Uint32Array(csrOff[unique.length]); const next = csrOff.slice(0, -1);
  edges.forEach((x, i) => [...new Set((x.cells || []).map(asCell).map(String))].forEach((c) => { csrEdge[next[index.get(c)]++] = i; }));
  const sections = [
    [S.NODE_LAT, TYPES.INT32, nodeLat], [S.NODE_LNG, TYPES.INT32, nodeLng], [S.NODE_ID, TYPES.BIGUINT64, nodeId],
    [S.EDGE_FROM, TYPES.UINT32, from], [S.EDGE_TO, TYPES.UINT32, to], [S.EDGE_LENGTH, TYPES.FLOAT32, length],
    [S.EDGE_HW, TYPES.UINT8, hw], [S.EDGE_ID, TYPES.BIGUINT64, edgeId], [S.GEOM_OFF, TYPES.UINT32, geomOff],
    [S.GEOM_POOL, TYPES.INT32, Int32Array.from(geom)], [S.CELL_OFF, TYPES.UINT32, cellOff],
    [S.CELL_POOL, TYPES.BIGUINT64, BigUint64Array.from(cells)], [S.CSR_CELL, TYPES.BIGUINT64, BigUint64Array.from(unique)],
    [S.CSR_OFF, TYPES.UINT32, csrOff], [S.CSR_EDGE, TYPES.UINT32, csrEdge],
  ];
  const tableBytes = sections.length * ENTRY; let pos = align(PREFIX + tableBytes);
  const entries = sections.map(([id, type, data]) => { const at = pos; pos = align(pos + data.byteLength); return { id, type, offset: at, bytes: data.byteLength, count: data.length, data }; });
  const out = new ArrayBuffer(pos); const bytes = new Uint8Array(out); const dv = new DataView(out);
  bytes.set(new TextEncoder().encode(BGRAPH_MAGIC), 0); dv.setUint8(5, VERSION); dv.setUint16(6, PREFIX + tableBytes, true);
  dv.setUint16(8, entries.length, true); dv.setUint32(10, n, true); dv.setUint32(14, e, true);
  bytes.set(new TextEncoder().encode(String(hash).padEnd(16, '0').slice(0, 16)), 18);
  entries.forEach((x, i) => { const p = PREFIX + i * ENTRY; dv.setUint16(p, x.id, true); dv.setUint8(p + 2, x.type); dv.setBigUint64(p + 4, BigInt(x.offset), true); dv.setBigUint64(p + 12, BigInt(x.bytes), true); dv.setUint32(p + 20, x.count, true); new Uint8Array(out, x.offset, x.bytes).set(new Uint8Array(x.data.buffer, x.data.byteOffset, x.bytes)); });
  return Buffer.from(out);
}

/** Decode topology; all numeric fields are views into the source ArrayBuffer. */
export function decodeBGraph(input) {
  const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength); const dv = new DataView(buffer);
  if (new TextDecoder().decode(new Uint8Array(buffer, 0, 5)) !== BGRAPH_MAGIC) throw new Error('Not a .bgraph file');
  if (dv.getUint8(5) !== VERSION) throw new Error('Unsupported .bgraph version');
  const count = dv.getUint16(8, true); const nodeCount = dv.getUint32(10, true); const edgeCount = dv.getUint32(14, true);
  const hash = new TextDecoder().decode(new Uint8Array(buffer, 18, 16)); const map = new Map();
  for (let i = 0; i < count; i++) { const p = PREFIX + i * ENTRY; map.set(dv.getUint16(p, true), { offset: Number(dv.getBigUint64(p + 4, true)), bytes: Number(dv.getBigUint64(p + 12, true)), count: dv.getUint32(p + 20, true) }); }
  const get = (id, type) => { const x = map.get(id); if (!x) throw new Error(`missing topology section ${id}`); return view(buffer, x.offset, x.count, type); };
  const nodeLat = get(S.NODE_LAT, Int32Array); const nodeLng = get(S.NODE_LNG, Int32Array); const nodeRaw = get(S.NODE_ID, BigUint64Array);
  const edgeFrom = get(S.EDGE_FROM, Uint32Array); const edgeTo = get(S.EDGE_TO, Uint32Array); const edgeLengthM = get(S.EDGE_LENGTH, Float32Array);
  const edgeHwClass = get(S.EDGE_HW, Uint8Array); const edgeIdsRaw = get(S.EDGE_ID, BigUint64Array); const edgeGeomOff = get(S.GEOM_OFF, Uint32Array);
  const edgeCellOff = get(S.CELL_OFF, Uint32Array); const geomRaw = get(S.GEOM_POOL, Int32Array); const cellPool = get(S.CELL_POOL, BigUint64Array);
  const csrSortedCells = get(S.CSR_CELL, BigUint64Array); const csrOffsets = get(S.CSR_OFF, Uint32Array); const csrEdgeIds = get(S.CSR_EDGE, Uint32Array);
  const nodeLats = new Float64Array(nodeCount); const nodeLngs = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) { nodeLats[i] = nodeLat[i] / 1e6; nodeLngs[i] = nodeLng[i] / 1e6; }
  const nodeIds = [...nodeRaw].map(String);
  const edgeIds = [...edgeIdsRaw].map(String);
  const getEdgeGeometry = (i) => { const result = []; for (let j = edgeGeomOff[i]; j < edgeGeomOff[i + 1]; j++) result.push({ lat: geomRaw[j * 2] / 1e6, lng: geomRaw[j * 2 + 1] / 1e6 }); return result; };
  const getEdgeCells = (i) => [...cellPool.subarray(edgeCellOff[i], edgeCellOff[i + 1])].map((x) => x.toString(16).padStart(15, '0'));
  return { nodeCount, edgeCount, hash, nodeLats, nodeLngs, nodeIds, nodeSerials: new Uint32Array(nodeCount).map((_, i) => i), edgeFrom, edgeTo, edgeLengthM, edgeHwClass, edgeIds, edgeGeomOff, edgeGeomLen: edgeGeomOff.slice(0, -1).map((x, i) => edgeGeomOff[i + 1] - x), edgeCellOff, edgeCellLen: edgeCellOff.slice(0, -1).map((x, i) => edgeCellOff[i + 1] - x), cellPool, csrSortedCells, csrOffsets, csrEdgeIds, getEdgeGeometry, getEdgeCells };
}

/** Encode edge risk with a length-prefixed UTF-8 dataVersion and exact body size. */
export function encodeBRisk({ edgeIds, risks, graphHash, riskSeq, dataVersion = '' }) {
  const text = new TextEncoder().encode(dataVersion); const header = align(40 + text.length); const out = Buffer.alloc(header + edgeIds.length * 4);
  out.write(BRISK_MAGIC, 0); out.writeUInt8(1, 5); out.write(String(graphHash).padEnd(16, '0').slice(0, 16), 6, 'ascii');
  out.writeUInt32LE(edgeIds.length, 22); out.writeUInt32LE(riskSeq >>> 0, 26); out.writeUInt16LE(text.length, 30); text.forEach((b, i) => out.writeUInt8(b, 32 + i));
  edgeIds.forEach((id, i) => BANDS.forEach((band, b) => { const v = risks[id]?.[band] ?? 0.5; out[i * 4 + header + b] = Math.max(0, Math.min(255, Math.round(v * 255))); }));
  return out;
}
/** Encode edge risk from a pre-quantized byte buffer (4 bytes per edge, BANDS order). */
export function encodeBRiskFromBytes({ edgeIds, bytes, graphHash, riskSeq, dataVersion = '' }) {
  const text = new TextEncoder().encode(dataVersion);
  const header = align(40 + text.length);
  if (bytes.length !== edgeIds.length * 4) throw new Error('BRISK byte length mismatch');
  const out = Buffer.alloc(header + bytes.length);
  out.write(BRISK_MAGIC, 0);
  out.writeUInt8(1, 5);
  out.write(String(graphHash).padEnd(16, '0').slice(0, 16), 6, 'ascii');
  out.writeUInt32LE(edgeIds.length, 22);
  out.writeUInt32LE(riskSeq >>> 0, 26);
  out.writeUInt16LE(text.length, 30);
  text.forEach((b, i) => out.writeUInt8(b, 32 + i));
  new Uint8Array(out.buffer, out.byteOffset + header, bytes.length).set(bytes);
  return out;
}
export function decodeBRisk(input) {
  if (input.toString('ascii', 0, 5) !== BRISK_MAGIC) throw new Error('Not a .brisk file');
  const edgeCount = input.readUInt32LE(22); const len = input.readUInt16LE(30); const header = align(40 + len);
  if (input.length !== header + edgeCount * 4) throw new Error('Invalid .brisk body length');
  return { graphHash: input.toString('ascii', 6, 22), edgeCount, riskSeq: input.readUInt32LE(26), dataVersion: input.toString('utf8', 32, 32 + len), riskBytes: new Uint8Array(input.buffer, input.byteOffset + header, edgeCount * 4) };
}
export function bsearchBigUint64(arr, val) { let lo = 0; let hi = arr.length - 1; while (lo <= hi) { const m = (lo + hi) >>> 1; if (arr[m] === val) return m; if (arr[m] < val) lo = m + 1; else hi = m - 1; } return -1; }

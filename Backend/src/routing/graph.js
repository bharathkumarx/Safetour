import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createGraph from 'ngraph.graph';
import { latLngToCell } from 'h3-js';

const bands = ['Morning', 'Afternoon', 'Evening', 'Night'];
const state = { drive: null, walk: null };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultArtifactDir = path.join(repoRoot, 'Data/processed');
const R = Math.PI / 180;
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

/** Collapse degree-two non-intersection nodes into geometry edges. */
export function buildRoutingGraph({ nodes = [], ways = [] } = {}) {
  const nodeMap = new Map(nodes.map((n) => [String(n.id), n]));
  const degree = new Map();
  for (const way of ways) for (const id of way.nodes) degree.set(id, (degree.get(id) || 0) + 1);
  const graph = createGraph(); const edges = []; const edgeById = new Map();
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
        graph.addLink(edge.from, edge.to, edge); edges.push(edge); edgeById.set(edge.id, edge);
        if (direction(way) === 0 && edge.from !== edge.to) {
          const reverse = { ...edge, id: `${edge.id}:r`, from: edge.to, to: edge.from, geometry: [...geometry].reverse() };
          graph.addLink(reverse.from, reverse.to, reverse); edges.push(reverse); edgeById.set(reverse.id, reverse);
        }
        start = id; geometry = [nodeMap.get(id)];
      }
    }
  }
  return { graph, nodes: nodeMap, edges, edgeById };
}

function sampleCells(geometry) {
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

/** Load a mode graph and its binary edge-risk artifact. */
export async function loadRoutingGraph({ mode = 'drive', graphPath = path.join(defaultArtifactDir, `blr_${mode}_graph.json`), riskPath = path.join(defaultArtifactDir, `blr_${mode}_edge_risk.bin`) } = {}) {
  const data = JSON.parse(await fs.readFile(graphPath, 'utf8'));
  const riskBuffer = await fs.readFile(riskPath);
  const riskData = JSON.parse(riskBuffer.toString('utf8'));
  const built = data.edges
    ? (() => {
      const graph = createGraph(); const nodes = new Map(data.nodes.map((node) => [String(node.id), node])); const edgeById = new Map();
      for (const edge of data.edges) { graph.addLink(edge.from, edge.to, edge); edgeById.set(edge.id, edge); }
      return { graph, nodes, edges: data.edges, edgeById };
    })()
    : buildRoutingGraph(data);
  state[mode] = {
    ...built,
    graphVersion: data.graphVersion,
    sccSize: data.sccSize ?? data.nodes?.length ?? built.nodes.size,
    nodesDropped: data.nodesDropped ?? 0,
    risks: riskData.risks || {},
  };
  return state[mode];
}
export const reloadEdgeRisk = async (mode = 'drive', riskPath = path.join(defaultArtifactDir, `blr_${mode}_edge_risk.bin`)) => {
  if (!state[mode]) return loadRoutingGraph({ mode });
  state[mode].risks = JSON.parse((await fs.readFile(riskPath)).toString('utf8')).risks || {};
  return state[mode];
};
export const getGraph = (mode = 'drive') => state[mode];
export const getEdge = (edgeId, mode = 'drive') => state[mode]?.edgeById.get(edgeId);
export const edgeRisk = (edgeId, band, mode = 'drive') => state[mode]?.risks?.[edgeId]?.[band] ?? 0.5;
export const edgesForCells = (cells, mode = 'drive') => (state[mode]?.edges || []).filter((edge) => edge.cells.some((cell) => cells.includes(cell)));
export function nearestNode(lat, lng, mode = 'drive') {
  const graph = state[mode]; if (!graph) throw new Error('GRAPH_NOT_LOADED');
  let best; let distance = Infinity;
  for (const node of graph.nodes.values()) { const d = haversine({ lat, lng }, node); if (d < distance) { distance = d; best = node; } }
  if (distance > 500) { const error = new Error('No road nearby'); error.code = 'NO_ROAD_NEARBY'; error.distanceMeters = distance; throw error; }
  return { node: best, distanceMeters: distance };
}
export const graphInfo = (mode = 'drive') => {
  const graph = state[mode];
  return graph
    ? {
        mode,
        graphVersion: graph.graphVersion,
        nodes: graph.nodes.size,
        edges: graph.edges.length,
        sccSize: graph.sccSize,
        nodesDropped: graph.nodesDropped,
      }
    : null;
};
export { bands };

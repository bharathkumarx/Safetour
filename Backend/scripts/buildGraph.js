import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env, validateOverpassUserAgent } from '../src/config/env.js';
import { Metadata } from '../src/models/CellRisk.js';
import { cachePathForTile, fetchOverpassTile, tileBboxes, overpassStatus, cachedTileStatus } from '../src/services/overpass.js';
import { buildRoutingGraph, loadRoutingGraph } from '../src/routing/graph.js';
import { encodeBGraph, encodeBRiskFromBytes, topologyHash, makeGraphVersion, parseGraphVersion } from '../src/routing/graphBinary.js';
import { decodeCellRiskMap, computeEdgeRiskBytes, CITY_MEAN_FALLBACK_RISK } from '../src/routing/edgeRisk.js';

const bounds = [12.80, 77.45, 13.18, 77.80];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultOutputDir = path.join(repoRoot, 'Data/processed');

export function largestScc(nodes, edges) {
  const out = new Map(nodes.map((n) => [String(n.id), []])); const rev = new Map(nodes.map((n) => [String(n.id), []]));
  for (const edge of edges) { out.get(edge.from)?.push(edge.to); rev.get(edge.to)?.push(edge.from); }
  const seen = new Set(); const order = [];
  for (const root of out.keys()) {
    if (seen.has(root)) continue;
    seen.add(root);
    const stack = [{ id: root, next: 0, neighbors: out.get(root) || [] }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.next < frame.neighbors.length) {
        const next = frame.neighbors[frame.next++];
        if (!seen.has(next)) {
          seen.add(next);
          stack.push({ id: next, next: 0, neighbors: out.get(next) || [] });
        }
      } else {
        order.push(frame.id);
        stack.pop();
      }
    }
  }
  const groups = []; seen.clear();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const root = order[i];
    if (seen.has(root)) continue;
    const group = new Set([root]); seen.add(root);
    const stack = [root];
    while (stack.length) {
      const id = stack.pop();
      for (const next of rev.get(id) || []) {
        if (!seen.has(next)) { seen.add(next); group.add(next); stack.push(next); }
      }
    }
    groups.push(group);
  }
  return groups.sort((a, b) => b.size - a.size)[0] || new Set();
}

function parseArgs(argv) {
  const tilesAt = argv.indexOf('--tiles');
  const tiles = tilesAt >= 0 ? argv[tilesAt + 1].split(',').map(Number).filter((n) => n >= 1 && n <= 16) : [...Array(16).keys()].map((n) => n + 1);
  const modeAt = argv.indexOf('--mode');
  return {
    tiles,
    mode: modeAt >= 0 ? argv[modeAt + 1] : null,
    resume: argv.includes('--resume'),
    fromCache: argv.includes('--from-cache'),
    allowPartial: argv.includes('--allow-partial'),
    status: argv.includes('--status'),
    convert: argv.includes('--convert'),
  };
}

async function buildMode(mode, { selectedTiles, resume = false, fromCache = false, onProgress = () => {} } = {}) {
  const combined = { nodes: new Map(), ways: [] };
  const boxes = tileBboxes(bounds);
  const failed = [];
  const fetchTiles = new Set(selectedTiles);
  const aggregateTiles = resume ? [...Array(16).keys()].map((n) => n + 1) : selectedTiles;
  for (const index of aggregateTiles) {
    const box = boxes[index - 1];
    const started = Date.now();
    let tile;
    try {
      const wasCached = await fs.access(cachePathForTile(box, mode)).then(() => true).catch(() => false);
      if (!fetchTiles.has(index) && resume && !wasCached) {
        failed.push(index);
        onProgress({ index, mode, status: 'failed', error: 'cache missing; selected for retry', elapsed: Date.now() - started });
        continue;
      }
      tile = await fetchOverpassTile(box, {
        mode, useCache: resume || fromCache, fromCache,
        onEvent: (details) => onProgress({ index, mode, ...details }),
      });
    } catch (error) {
      failed.push(index);
      onProgress({ index, mode, status: 'failed', error: error.message, elapsed: Date.now() - started });
      continue;
    }
    tile.nodes.forEach((node) => combined.nodes.set(node.id, node));
    for (const way of tile.ways) combined.ways.push(way);
  }
  const built = buildRoutingGraph({ nodes: [...combined.nodes.values()], ways: combined.ways });
  const keep = largestScc([...combined.nodes.values()], built.edges);
  const edges = built.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to));
  const nodes = [...combined.nodes.values()].filter((node) => keep.has(node.id));
  const keptWays = combined.ways.filter((way) => way.nodes.some((id) => keep.has(id)));
  const hash = topologyHash(nodes.length, edges.length, edges[0]?.id || '');
  return {
    graphVersion: makeGraphVersion(hash, 0),
    hash,
    nodes,
    ways: keptWays,
    edges,
    sampledCells: [...new Set(edges.flatMap((edge) => edge.cells))],
    failed,
    sccSize: keep.size,
    nodesDropped: combined.nodes.size - keep.size,
  };
}

/**
 * Edge descriptors for the shared risk builder. Built from a decoded `.bgraph`
 * (or a freshly built in-memory graph) so both the offline full build and the
 * incremental refresh use the exact same length-weighted sampler.
 */
function edgesForRisk(graph) {
  const n = graph.edgeCount ?? graph.edges.length;
  const arr = new Array(n);
  for (let i = 0; i < n; i++) {
    const edge = graph.edges ? graph.edges[i] : null;
    if (edge) {
      arr[i] = { serial: edge.serial ?? i, id: edge.id, cells: edge.cells, cellWeights: edge.cellWeights };
    } else {
      const cells = graph.getEdgeCells(i);
      arr[i] = { serial: i, id: graph.edgeIds[i], cells, cellWeights: null };
    }
  }
  return arr;
}

export async function writeRiskArtifacts(results, {
  outputDir = defaultOutputDir, cellRisks = [], cityMeanRisk = CITY_MEAN_FALLBACK_RISK, dataVersion = '',
} = {}) {
  await fs.mkdir(outputDir, { recursive: true });
  // Build once; computeEdgeRiskBytes throws EDGE_RISK_NO_CELLRISK when empty.
  const cellRiskMap = decodeCellRiskMap(cellRisks);
  if (cellRiskMap.size === 0) {
    throw new Error('EDGE_RISK_NO_CELLRISK: CellRisk is empty; refusing to write a flat .brisk (run build:risk first)');
  }
  for (const [mode, graph] of Object.entries(results)) {
    const edgeIds = graph.edges.map((e) => e.id);
    const edges = edgesForRisk(graph);
    const { bytes, fallbackBandCount } = computeEdgeRiskBytes(edges, cellRiskMap, cityMeanRisk);
    const hash = graph.hash || topologyHash(graph.nodes.length, graph.edges.length, edgeIds[0] || '');
    const { seq } = parseGraphVersion(graph.graphVersion);
    const briskBuf = encodeBRiskFromBytes({ edgeIds, bytes, graphHash: hash, riskSeq: seq, dataVersion });
    const briskPath = path.join(outputDir, `blr_${mode}.brisk`);
    await fs.writeFile(`${briskPath}.next`, briskBuf);
    await fs.rename(`${briskPath}.next`, briskPath);
    const fallbackEdges = fallbackBandCount ? Math.round(fallbackBandCount / 4) : 0;
    console.log(`[build:graph] ${mode}: ${fallbackEdges} edges used city-mean risk fallback (${fallbackBandCount}/${edges.length * 4} bands)`);
    console.log(`[build:graph] ${mode}: wrote ${briskPath} (${briskBuf.length} bytes)`);
  }
}

export async function buildGraphs({
  modes = ['drive', 'walk'], outputDir = defaultOutputDir, cellRisks = [], cityMeanRisk = 0.5,
  selectedTiles = [...Array(16).keys()].map((n) => n + 1), resume = false, fromCache = false,
  allowPartial = false, onProgress = () => {}, writeRisks = true,
} = {}) {
  if ((selectedTiles.length < 16 || selectedTiles.length === 0) && !allowPartial && !resume) {
    throw new Error('Refusing graph build: all 16 tiles are required (use --allow-partial to override)');
  }
  const results = {};
  for (const mode of modes) {
    const graph = await buildMode(mode, { selectedTiles, resume, fromCache, onProgress });
    if (graph.failed.length && !allowPartial) {
      const error = new Error(`Refusing graph build: missing tiles ${graph.failed.join(',')} (use --allow-partial to override)`);
      error.failed = graph.failed;
      throw error;
    }
    if (graph.failed.length) console.warn(`WARNING: partial graph; missing tiles: ${graph.failed.join(',')}`);
    await fs.mkdir(outputDir, { recursive: true });
    // Write binary .bgraph
    const bgraphPath = path.join(outputDir, `blr_${mode}.bgraph`);
    const bgraphBuf = encodeBGraph({ nodes: graph.nodes, edges: graph.edges, hash: graph.hash });
    await fs.writeFile(`${bgraphPath}.next`, bgraphBuf);
    await fs.rename(`${bgraphPath}.next`, bgraphPath);
    results[mode] = graph;
  }
  if (writeRisks) await writeRiskArtifacts(results, { outputDir, cellRisks, cityMeanRisk });
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));

  if (args.fromCache) {
    // Refuse any network request when --from-cache is set
    process.env.OVERPASS_FROM_CACHE_ONLY = '1';
  }

  try { validateOverpassUserAgent(); } catch (error) { console.error(error.message); process.exit(1); }
  if (args.status) {
    const statuses = await overpassStatus({ logger: (line) => console.log(line) });
    statuses.forEach((result) => {
      console.log(`${result.endpoint} status ${result.status ?? 'unknown'}`);
      if (result.text) console.log(result.text);
    });
    const cache = await cachedTileStatus();
    cache.forEach((tile) => console.log(`${tile.mode} tile ${tile.index}: ${tile.missing ? 'missing' : `${tile.size} bytes, age ${Math.round(tile.age)}ms`}`));
    process.exit(0);
  }
  const selectedTiles = args.tiles;
  const modes = args.mode ? [args.mode] : ['drive', 'walk'];
  const buildStarted = performance.now();
  const progress = ({ index, status, elapsed = 0, event = status, retryAfter = '-', wait = 0, why = '', attempt = '' }) => {
    const nextWait = status === 'fetched' || status === 'cached' ? Math.max(0, env.OVERPASS_TILE_DELAY_MS) : 0;
    console.log(`tile ${index}/16 event ${event} status ${status} Retry-After ${retryAfter} wait ${wait || nextWait}ms why ${why || '-'} attempt ${attempt || '-'} elapsed ${Math.round(elapsed)}ms`);
  };
  let results;
  try {
    results = await buildGraphs({
      modes, selectedTiles, resume: args.resume, fromCache: args.fromCache,
      allowPartial: args.allowPartial, onProgress: progress, writeRisks: false,
    });
  } catch (error) {
    if (!error.failed) {
      console.error(error.stack || error);
      const total = args.fromCache ? selectedTiles.length : 16;
      console.error(`tiles OK (${total}/${total} cached); failure happened while building the graph`);
      console.error(`Next command: npm run build:graph -- --mode ${modes[0]} --from-cache`);
      process.exit(1);
    }
    const missing = error.failed || selectedTiles;
    console.error(error.message);
    console.error(`Retry command: npm run build:graph -- --mode ${modes[0]} --tiles ${missing.join(',')} --resume`);
    process.exit(1);
  }
  await mongoose.connect(env.MONGODB_URI);
  const { CellRisk } = await import('../src/models/CellRisk.js');
  const metadata = await Metadata.findOne({}).lean();
  const cellRisks = await CellRisk.find({}).select('h3 band risk').lean();
  await writeRiskArtifacts(results, {
    cellRisks,
    cityMeanRisk: metadata?.cityMeanRisk ?? 0.5,
    dataVersion: metadata?.dataVersion || '',
  });
  await Metadata.updateOne({}, { $set: { graphVersion: Object.values(results).map((r) => r.graphVersion).join(',') } });
  await mongoose.disconnect();
  const missing = [...new Set(Object.values(results).flatMap((r) => r.failed))];
  const elapsedMs = Math.round(performance.now() - buildStarted);
  const memory = process.memoryUsage();
  const graphStats = {};
  for (const mode of modes) {
    const graphPath = path.join(defaultOutputDir, `blr_${mode}.bgraph`);
    const riskPath = path.join(defaultOutputDir, `blr_${mode}.brisk`);
    const [graphFile, riskFile] = await Promise.all([fs.stat(graphPath), fs.stat(riskPath)]);
    const loadStarted = performance.now();
    await loadRoutingGraph({ mode, graphPath, riskPath });
    graphStats[mode] = {
      nodes: results[mode].nodes.length,
      edges: results[mode].edges.length,
      sccSize: results[mode].sccSize,
      nodesDropped: results[mode].nodesDropped,
      graphBytes: graphFile.size,
      edgeRiskBytes: riskFile.size,
      loadMs: Math.round(performance.now() - loadStarted),
    };
  }
  if (missing.length) console.log(`Retry command: npm run build:graph -- --mode ${modes[0]} --tiles ${missing.join(',')} --resume${args.allowPartial ? ' --allow-partial' : ''}`);
  console.log(JSON.stringify({ elapsedMs, peakMemoryBytes: memory.rss, modes: graphStats }, null, 2));
}

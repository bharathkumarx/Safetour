/**
 * measureGraphMemory.js
 *
 * Reports memory usage after loading the routing graph.
 * Run from Backend/ as: node --expose-gc scripts/measureGraphMemory.js
 *
 * Uses the same loader and paths as the production server.
 */
import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const processedDir = path.join(repoRoot, 'Data/processed');

/** Bytes → MiB string */
const mib = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;

async function getFileSize(p) {
  try { return (await fs.stat(p)).size; } catch { return 0; }
}

async function measure(mode = 'drive') {
  // Force a GC baseline before loading
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();

  const graphPath = path.join(processedDir, `blr_${mode}.bgraph`);
  const riskPath = path.join(processedDir, `blr_${mode}.brisk`);

  const t0 = performance.now();
  await fs.readFile(graphPath);
  const tReadGraph = performance.now();
  await fs.readFile(riskPath);
  const tReadRisk = performance.now();

  // ── import and load through graph.js (same as server startup) ─────────────
  const { loadRoutingGraph, getGraph } = await import('../src/routing/graph.js');
  const tImport = performance.now();

  await loadRoutingGraph({ mode, graphPath, riskPath });
  const tLoad = performance.now();

  const g = getGraph(mode);

  // ── force a GC so we measure retained live objects only ───────────────────
  if (global.gc) global.gc();
  const memAfter = process.memoryUsage();

  // ── file sizes ────────────────────────────────────────────────────────────
  const [graphFileBytes, riskFileBytes] = await Promise.all([
    getFileSize(graphPath),
    getFileSize(riskPath),
  ]);

  const result = {
    mode,
    files: {
      graphBinary: `${mib(graphFileBytes)} (${graphFileBytes} B)`,
      edgeRiskBinary: `${mib(riskFileBytes)} (${riskFileBytes} B)`,
    },
    timing: {
      readGraphMs: Math.round(tReadGraph - t0),
      readRiskMs: Math.round(tReadRisk - tReadGraph),
      importGraphJsMs: Math.round(tImport - tReadRisk),
      loadRoutingGraphMs: Math.round(tLoad - tImport),
      totalLoadMs: Math.round(tLoad - t0),
    },
    graphStats: g ? {
      nodes: g.nodeCount,
      edges: g.edgeCount,
    } : null,
    memoryDeltaMiB: {
      heapUsed: mib(memAfter.heapUsed - memBefore.heapUsed),
      rss: mib(memAfter.rss - memBefore.rss),
      external: mib(memAfter.external - memBefore.external),
      arrayBuffers: mib(memAfter.arrayBuffers - memBefore.arrayBuffers),
    },
    memoryAfterGcMiB: {
      heapUsed: mib(memAfter.heapUsed),
      heapTotal: mib(memAfter.heapTotal),
      rss: mib(memAfter.rss),
      external: mib(memAfter.external),
      arrayBuffers: mib(memAfter.arrayBuffers),
    },
    memoryAfterGcRaw: {
      heapUsedBytes: memAfter.heapUsed,
      heapTotalBytes: memAfter.heapTotal,
      rssBytes: memAfter.rss,
      externalBytes: memAfter.external,
      arrayBuffersBytes: memAfter.arrayBuffers,
    },
  };

  return result;
}

const mode = process.argv[2] || 'drive';
console.error(`[graph:measure] Measuring mode=${mode} …`);
const result = await measure(mode);
console.log(JSON.stringify(result, null, 2));

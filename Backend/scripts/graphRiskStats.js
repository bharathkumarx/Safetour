/**
 * graphRiskStats.js — print byte statistics for a .brisk edge-risk artifact.
 *
 * Usage: node scripts/graphRiskStats.js [--mode walk] [--no-zero-cells]
 * Reads Data/processed/blr_<mode>.bgraph + blr_<mode>.brisk (defaults).
 * Run as: npm run graph:risk-stats
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoutingGraph } from '../src/routing/graph.js';
import { BANDS, decodeBRisk } from '../src/routing/graphBinary.js';
import { computeRiskStats, cityMeanByte, CITY_MEAN_FALLBACK_RISK } from '../src/routing/edgeRisk.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultDir = path.join(repoRoot, 'Data/processed');

function parseArgs(argv) {
  const modeAt = argv.indexOf('--mode');
  const mode = modeAt >= 0 ? argv[modeAt + 1] : 'drive';
  return { mode };
}

async function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const dir = defaultDir;
  const graphPath = path.join(dir, `blr_${mode}.bgraph`);
  const briskPath = path.join(dir, `blr_${mode}.brisk`);

  for (const p of [graphPath, briskPath]) {
    try { await fs.access(p); } catch { console.error(`[graph:risk-stats] missing artifact: ${p}`); process.exit(1); }
  }

  const st = await loadRoutingGraph({ mode, graphPath, riskPath: briskPath });
  if (!st) { console.error(`[graph:risk-stats] graph for mode "${mode}" not loaded`); process.exit(1); }
  const riskBuf = await fs.readFile(briskPath);
  const decoded = decodeBRisk(riskBuf);
  if (decoded.edgeCount !== st.edgeCount) {
    console.error(`[graph:risk-stats] edge count mismatch: .brisk=${decoded.edgeCount} vs .bgraph=${st.edgeCount}`);
    process.exit(1);
  }
  // City-mean risk is the configured shrinkage baseline (0.5). Its byte is 128.
  const cityMean = CITY_MEAN_FALLBACK_RISK;
  const meanByte = cityMeanByte(cityMean);

  const stats = computeRiskStats(st.edgeCount, decoded.riskBytes, meanByte, st.edgeCellLen);

  console.log(`[graph:risk-stats] mode=${mode} edges=${st.edgeCount} riskSeq=${decoded.riskSeq} dataVersion=${JSON.stringify(decoded.dataVersion)} cityMeanRisk=${cityMean} (byte ${meanByte})`);
  console.log('band        min  p10  median   p90  max  distinct  #cityMean  #edges_zero_cells');
  for (const b of stats.perBand) {
    console.log(`${b.band.padEnd(9)} ${String(b.min).padStart(3)} ${String(b.p10).padStart(4)} ${String(b.median).padStart(6)} ${String(b.p90).padStart(5)} ${String(b.max).padStart(3)} ${String(b.distinct).padStart(8)} ${String(b.countCityMean).padStart(10)} ${stats.zeroCellEdges ?? '-'}`);
  }
  const totalMean = stats.perBand.reduce((s, b) => s + b.countCityMean, 0);
  const total = st.edgeCount * BANDS.length;
  console.log(`[graph:risk-stats] city-mean fallback cells: ${totalMean}/${total} (${((totalMean / total) * 100).toFixed(2)}%) across ${BANDS.length} bands`);
  console.log(`[graph:risk-stats] edges with zero sampled cells: ${stats.zeroCellEdges ?? 'n/a'}`);
}

main().catch((error) => { console.error(error); process.exit(1); });

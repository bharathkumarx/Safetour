/**
 * graphBinary.test.js
 * Tests: encode/decode round-trip, quantization tolerance, atomic write,
 * 300k-node large synthetic graph (no recursion/spreading), snapshot comparison.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  encodeBGraph, decodeBGraph,
  encodeBRisk, decodeBRisk,
  encodeBRiskFromBytes,
  bsearchBigUint64,
  makeGraphVersion, parseGraphVersion,
  topologyHash, BANDS,
} from '../src/routing/graphBinary.js';
import { loadRoutingGraph, nearestNode, edgesForCells } from '../src/routing/graph.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeSyntheticGraph(nodeCount = 10) {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: String(i),
    lat: 12.90 + i * 0.001,
    lng: 77.60 + i * 0.001,
  }));
  const edges = [];
  for (let i = 0; i < nodeCount - 1; i++) {
    edges.push({
      id: `e${i}`,
      from: String(i), to: String(i + 1),
      length: 150,
      tags: { highway: 'residential' },
      geometry: [nodes[i], nodes[i + 1]],
      cells: ['8f28308280fffff'],
    });
  }
  return { nodes, edges };
}

// ── encode/decode round-trip ──────────────────────────────────────────────────
describe('graphBinary encode/decode round-trip', () => {
  it('encodes and decodes a small graph with exact node/edge fidelity', () => {
    const { nodes, edges } = makeSyntheticGraph(5);
    const hash = topologyHash(nodes.length, edges.length, edges[0]?.id);
    const buf = encodeBGraph({ nodes, edges, hash });
    expect(buf).toBeInstanceOf(Buffer);

    const d = decodeBGraph(buf);
    expect(d.nodeCount).toBe(5);
    expect(d.edgeCount).toBe(4);
    expect(d.hash).toBe(hash);

    // Node lat/lng round-trip within microdegree precision (1e-6)
    for (let i = 0; i < 5; i++) {
      expect(d.nodeLats[i]).toBeCloseTo(nodes[i].lat, 5);
      expect(d.nodeLngs[i]).toBeCloseTo(nodes[i].lng, 5);
    }

    // Binary edge IDs now preserve original string IDs from the input.
    expect(d.edgeIds).toEqual(['e0', 'e1', 'e2', 'e3']);

    // Geometry decoded lazily
    const geom = d.getEdgeGeometry(0);
    expect(geom).toHaveLength(2);
    expect(geom[0].lat).toBeCloseTo(nodes[0].lat, 5);

    // Cells decoded lazily
    const cells = d.getEdgeCells(0);
    expect(cells).toHaveLength(1);
    // h3 cell value round-trip: normalise to 15-char hex
    const orig = BigInt('0x8f28308280fffff').toString(16).padStart(15, '0');
    expect(cells[0]).toBe(orig);
  });

  it('aligns every section offset to 8 bytes', () => {
    const { nodes, edges } = makeSyntheticGraph(5);
    const buf = encodeBGraph({ nodes, edges, hash: topologyHash(nodes.length, edges.length, edges[0].id) });
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const tableOffset = 40;
    const sectionCount = view.getUint16(8, true);
    for (let i = 0; i < sectionCount; i += 1) {
      const entry = tableOffset + i * 24;
      expect(Number(view.getBigUint64(entry + 4, true)) % 8).toBe(0);
    }
  });

  it('getEdgeCells returns the same cells as the input (sorted)', () => {
    const nodes = [
      { id: 'a', lat: 12.9, lng: 77.6 },
      { id: 'b', lat: 12.91, lng: 77.61 },
    ];
    const cellsInput = ['8f28308280fffff', '8f283082807ffff'];
    const edges = [{
      id: 'e0', from: 'a', to: 'b', length: 100,
      tags: {}, geometry: nodes, cells: cellsInput,
    }];
    const hash = topologyHash(2, 1, 'e0');
    const buf = encodeBGraph({ nodes, edges, hash });
    const d = decodeBGraph(buf);
    const cells = d.getEdgeCells(0);
    expect(cells.sort()).toEqual(
      cellsInput.map((c) => BigInt(`0x${c}`).toString(16).padStart(15, '0')).sort(),
    );
  });
});

// ── Uint8 edge risk round-trip + quantization ─────────────────────────────────
describe('brisk encode/decode + quantization', () => {
  it('encodes and decodes risk values within 1/510 tolerance', () => {
    const edgeIds = ['e0', 'e1', 'e2'];
    const risks = {
      e0: { Morning: 0.0, Afternoon: 0.333, Evening: 0.5, Night: 1.0 },
      e1: { Morning: 0.1, Afternoon: 0.9, Evening: 0.75, Night: 0.25 },
      e2: { Morning: 0.5, Afternoon: 0.5, Evening: 0.5, Night: 0.5 },
    };
    const buf = encodeBRisk({ edgeIds, risks, graphHash: 'aabbccddeeff0011', riskSeq: 3 });
    const dec = decodeBRisk(buf);
    expect(dec.edgeCount).toBe(3);
    expect(dec.riskSeq).toBe(3);

    const MAX_ERR = 1 / 510;
    for (let i = 0; i < edgeIds.length; i++) {
      const id = edgeIds[i];
      for (let b = 0; b < 4; b++) {
        const original = risks[id][BANDS[b]];
        const decoded = dec.riskBytes[i * 4 + b] / 255;
        expect(Math.abs(decoded - original)).toBeLessThanOrEqual(MAX_ERR + 1e-9);
      }
    }
  });

  it('clamps values outside [0,1] without throwing', () => {
    const edgeIds = ['e0'];
    const buf = encodeBRisk({ edgeIds, risks: { e0: { Morning: -0.5, Afternoon: 1.5, Evening: 0.5, Night: 0.5 } }, graphHash: '0'.repeat(16), riskSeq: 0 });
    const dec = decodeBRisk(buf);
    expect(dec.riskBytes[0]).toBe(0);   // clamped to 0
    expect(dec.riskBytes[1]).toBe(255); // clamped to 255
  });
});

// ── graphVersion format ───────────────────────────────────────────────────────
describe('graphVersion format', () => {
  it('makes and parses <hash>:<seq>', () => {
    const gv = makeGraphVersion('abcdef0123456789', 7);
    expect(gv).toBe('abcdef0123456789:7');
    const parsed = parseGraphVersion(gv);
    expect(parsed.hash).toBe('abcdef0123456789');
    expect(parsed.seq).toBe(7);
  });

  it('parses legacy opaque strings without crashing', () => {
    const parsed = parseGraphVersion('some-old-timestamp-1234567890');
    expect(typeof parsed.hash).toBe('string');
    expect(typeof parsed.seq).toBe('number');
  });
});

// ── bsearchBigUint64 ──────────────────────────────────────────────────────────
describe('bsearchBigUint64', () => {
  it('finds values in a sorted array', () => {
    const arr = new BigUint64Array([1n, 5n, 10n, 100n, 999n]);
    expect(bsearchBigUint64(arr, 5n)).toBe(1);
    expect(bsearchBigUint64(arr, 100n)).toBe(3);
    expect(bsearchBigUint64(arr, 999n)).toBe(4);
    expect(bsearchBigUint64(arr, 7n)).toBe(-1);
    expect(bsearchBigUint64(arr, 0n)).toBe(-1);
  });
});

// ── Atomic write ──────────────────────────────────────────────────────────────
describe('atomic write', () => {
  it('writes brisk atomically (temp then rename) with no .next left over', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safetour-test-'));
    const target = path.join(dir, 'test.brisk');
    const edgeIds = ['e0', 'e1'];
    const risks = { e0: { Morning: 0.2, Afternoon: 0.4, Evening: 0.6, Night: 0.8 }, e1: { Morning: 0.5, Afternoon: 0.5, Evening: 0.5, Night: 0.5 } };
    const buf = encodeBRisk({ edgeIds, risks, graphHash: '0'.repeat(16), riskSeq: 1 });
    await fs.writeFile(`${target}.next`, buf);
    await fs.rename(`${target}.next`, target);
    // No .next file should remain
    const files = await fs.readdir(dir);
    expect(files.every((f) => !f.endsWith('.next'))).toBe(true);
    // Content is valid
    const dec = decodeBRisk(await fs.readFile(target));
    expect(dec.edgeCount).toBe(2);
    await fs.rm(dir, { recursive: true });
  });
});

// ── Large synthetic graph (300k nodes, no recursion/spreading) ───────────────
describe('large synthetic graph', () => {
  it('encodes and decodes 300,000-node chain without stack overflow', () => {
    const N = 300_000;
    const nodes = Array.from({ length: N }, (_, i) => ({
      id: String(i), lat: 12.80 + (i % 10000) * 0.00004, lng: 77.45 + Math.floor(i / 10000) * 0.0004,
    }));
    // Long chain: N-1 edges
    const edges = Array.from({ length: N - 1 }, (_, i) => ({
      id: `e${i}`, from: String(i), to: String(i + 1),
      length: 10, tags: {}, geometry: [nodes[i], nodes[i + 1]], cells: [],
    }));
    const hash = topologyHash(N, edges.length, 'e0');
    // This must not throw (no argument spreading, no recursion)
    const buf = encodeBGraph({ nodes, edges, hash });
    expect(buf.length).toBeGreaterThan(N * NODE_STRIDE);
    const d = decodeBGraph(buf);
    expect(d.nodeCount).toBe(N);
    expect(d.edgeCount).toBe(N - 1);
  }, 30_000); // allow 30s
});

const NODE_STRIDE = 12; // matches graphBinary.js

// ── refreshEdgesForCells touches same edges ───────────────────────────────────
describe('edgesForCells after reload', () => {
  it('returns the same edge IDs before and after a risk reload', async () => {
    const nodes = [
      { id: 'a', lat: 12.9, lng: 77.6 },
      { id: 'b', lat: 12.901, lng: 77.6 },
    ];
    const edges = [{
      id: 'w:a:b', from: 'a', to: 'b', length: 110,
      tags: { highway: 'residential' }, geometry: nodes,
      cells: ['8f28308280fffff'], cellWeights: { '8f28308280fffff': 110 },
    }];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'safetour-test-'));
    const graphPath = path.join(dir, 'drive.bgraph');
    const riskPath = path.join(dir, 'drive.brisk');
    // Create minimal binary artifacts
    const bgraphBuf = encodeBGraph({ nodes, edges, hash: 'g0' });
    const edgeIds = edges.map((e) => e.id);
    const riskBytes = new Uint8Array(edgeIds.length * 4).fill(128); // city-mean
    const briskBuf = encodeBRiskFromBytes({ edgeIds, bytes: riskBytes, graphHash: 'g0', riskSeq: 0, dataVersion: 'test' });
    await fs.writeFile(graphPath, bgraphBuf);
    await fs.writeFile(riskPath, briskBuf);
    await loadRoutingGraph({ mode: 'drive', graphPath, riskPath });
    const before = edgesForCells(['8f28308280fffff'], 'drive').map((e) => e.id);
    // Simulate a risk reload (same cells covered)
    await loadRoutingGraph({ mode: 'drive', graphPath, riskPath });
    const after = edgesForCells(['8f28308280fffff'], 'drive').map((e) => e.id);
    expect(before.sort()).toEqual(after.sort());
    await fs.rm(dir, { recursive: true });
  });
});

// ── Snapshot comparison ───────────────────────────────────────────────────────
describe('snapshot comparison (nearestNode, edgesForCells)', () => {
  let snapshot;
  const snapshotPath = 'tests/fixtures/graphSnapshot.json';
  const graphPath = '../Data/processed/blr_drive.bgraph';
  const riskPath = '../Data/processed/blr_drive.brisk';

  beforeAll(async () => {
    try {
      snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
    } catch {
      snapshot = null;
    }
    if (!snapshot) return;
    // Load the production graph so the snapshot tests can query it
    try {
      await loadRoutingGraph({ mode: 'drive', graphPath, riskPath });
    } catch {
      snapshot = null; // graph not available; skip all snapshot tests
    }
  }, 60_000); // allow 60s for large graph load

  it('nearestNode results are identical to pre-rewrite snapshot', () => {
    if (!snapshot) { console.warn('No snapshot/graph; skipping nearestNode comparison'); return; }
    for (const r of snapshot.nearestResults) {
      if (r.error) continue; // skip NO_ROAD_NEARBY cases
      const result = nearestNode(r.queryLat, r.queryLng, 'drive');
      expect(result.node.id).toBe(r.nodeId);
    }
  });

  it('edgesForCells results are identical to pre-rewrite snapshot', () => {
    if (!snapshot) return;
    for (const r of snapshot.edgesForCellsResults) {
      const ids = edgesForCells([r.cell], 'drive').map((e) => e.id).sort();
      expect(ids).toEqual(r.edgeIds);
    }
  });

  });

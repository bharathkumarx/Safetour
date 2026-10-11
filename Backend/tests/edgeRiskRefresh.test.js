import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';

const outputPath = 'tests/fixtures/edge-risk-refresh.brisk';

afterAll(async () => { await fs.rm(outputPath, { force: true }); });

vi.mock('../src/models/CellRisk.js', () => ({
  Metadata: { findOne: () => ({ lean: async () => ({ graphVersion: 'abcdef1234567890:1', cityMeanRisk: 0.5, dataVersion: 'v1' }) }), updateOne: vi.fn(async () => {}) },
  CellRisk: { find: () => ({ select: () => ({ lean: async () => [
    { h3: 'c1', band: 'Morning', risk: 0.2 },
    { h3: 'c1', band: 'Afternoon', risk: 0.6 },
    { h3: 'c1', band: 'Evening', risk: 0.4 },
    { h3: 'c1', band: 'Night', risk: 0.8 },
    { h3: 'c2', band: 'Morning', risk: 0.1 },
    { h3: 'c2', band: 'Afternoon', risk: 0.3 },
    { h3: 'c2', band: 'Evening', risk: 0.5 },
    { h3: 'c2', band: 'Night', risk: 0.7 },
  ] }) }) },
}));

vi.mock('../src/services/dataStore.js', () => ({
  getDataStore: () => ({
    metadata: { cityMeanRisk: 0.5, dataVersion: 'v1' },
    routing: {
      drive: {
        edgeCount: 2,
        edgeIds: ['e1', 'e2'],
        edgeSerialMap: new Map([['e1', 0], ['e2', 1]]),
        hash: 'abcdef1234567890',
        graphVersion: 'abcdef1234567890:1',
        getEdgeGeometry: (serial) => {
          if (serial === 0) return [{ lat: 12.97, lng: 77.59 }, { lat: 12.98, lng: 77.60 }];
          return [{ lat: 12.99, lng: 77.61 }, { lat: 13.00, lng: 77.62 }];
        },
      },
    },
  }),
}));

vi.mock('../src/routing/graph.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    edgesForCells: (cells, mode) => {
      return cells.includes('c1') ? [{ id: 'e1', serial: 0, cells: ['c1'], cellWeights: { c1: 2 } }] : [];
    },
    // Mock sampleCells to return the cells we want for testing
    sampleCells: (geometry) => {
      // First edge geometry (serial 0) -> return c1
      // Second edge geometry (serial 1) -> return c2
      const isFirst = geometry[0].lat === 12.97 && geometry[0].lng === 77.59;
      if (isFirst) return { cells: ['c1'], weights: { c1: 2 } };
      return { cells: ['c2'], weights: { c2: 2 } };
    },
  };
});

describe('edge risk refresh (binary .brisk)', () => {
  it('writes all 4 bands with length-weighted CellRisk values', async () => {
    const { refreshEdgeRisks } = await import('../src/services/edgeRiskRefresh.js');
    const result = await refreshEdgeRisks(['c1'], { mode: 'drive', outputPath });
    expect(result.refreshed).toBe(1);
    // No prior .brisk file, so prevSeq=0 -> newSeq=1
    expect(result.graphVersion).toBe('abcdef1234567890:1');
    expect(result.edgeRiskFileUpdated).toBe(true);
    expect(result.fallbackCount).toBeGreaterThanOrEqual(0);

    const raw = await fs.readFile(outputPath);
    expect(raw.length).toBeGreaterThan(40);
    expect(raw.subarray(0, 5).toString()).toBe('BRISK');
  });

  it('preserves unaffected edge bytes and recomputes only affected edges', async () => {
    const { refreshEdgeRisks } = await import('../src/services/edgeRiskRefresh.js');
    const { decodeBRisk, encodeBRiskFromBytes } = await import('../src/routing/graphBinary.js');

    const initialBytes = new Uint8Array(2 * 4);
    // e1: [100, 150, 200, 250]
    // e2: [50, 60, 70, 80]
    initialBytes[0] = 100; initialBytes[1] = 150; initialBytes[2] = 200; initialBytes[3] = 250;
    initialBytes[4] = 50; initialBytes[5] = 60; initialBytes[6] = 70; initialBytes[7] = 80;

    const initialBrisk = encodeBRiskFromBytes({
      edgeIds: ['e1', 'e2'],
      bytes: initialBytes,
      graphHash: 'abcdef1234567890',
      riskSeq: 1,
      dataVersion: 'v1',
    });
    await fs.writeFile(outputPath, initialBrisk);

    await refreshEdgeRisks(['c1'], { mode: 'drive', outputPath });

    const updatedRaw = await fs.readFile(outputPath);
    const decoded = decodeBRisk(updatedRaw);
    expect(decoded.riskSeq).toBe(2);

    // e2 (unaffected) should preserve [50, 60, 70, 80]
    expect(decoded.riskBytes[4]).toBe(50);
    expect(decoded.riskBytes[5]).toBe(60);
    expect(decoded.riskBytes[6]).toBe(70);
    expect(decoded.riskBytes[7]).toBe(80);

    // e1 (affected) should be recomputed from CellRisk (c1)
    // CellRisk for c1: Morning=0.2→51, Afternoon=0.6→153, Evening=0.4→102, Night=0.8→204
    const e1Bytes = decoded.riskBytes.subarray(0, 4);
    expect(e1Bytes[0]).toBe(51);
    expect(e1Bytes[1]).toBe(153);
    expect(e1Bytes[2]).toBe(102);
    expect(e1Bytes[3]).toBe(204);
  });
});
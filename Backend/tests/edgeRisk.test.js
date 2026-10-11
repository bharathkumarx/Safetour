import { describe, expect, it } from 'vitest';
import {
  roundByte, cityMeanByte, CITY_MEAN_FALLBACK_RISK,
  edgeBandByte, patchRiskBytes, computeEdgeRiskBytes,
  edgesFromBgraph, decodeCellRiskMap, computeRiskStats,
  BANDS,
} from '../src/routing/edgeRisk.js';

describe('edgeRisk core functions', () => {
  it('roundByte clamps 0..255', () => {
    expect(roundByte(0)).toBe(0);
    expect(roundByte(1)).toBe(255);
    expect(roundByte(0.5)).toBe(128);
    expect(roundByte(-0.1)).toBe(0);
    expect(roundByte(1.1)).toBe(255);
  });

  it('cityMeanByte returns 128 for default 0.5', () => {
    expect(cityMeanByte()).toBe(128);
    expect(cityMeanByte(0.4)).toBe(102);
  });

  it('edgeBandByte returns cityMeanByte when no cells covered', () => {
    const cellRiskMap = new Map();
    const { byte, fellBack } = edgeBandByte(cellRiskMap, ['c1'], null, 'Morning', 0.5);
    expect(byte).toBe(128);
    expect(fellBack).toBe(true);
  });

  it('edgeBandByte computes length-weighted average when cells covered', () => {
    const cellRiskMap = new Map([['c1:Morning', 0.2], ['c2:Morning', 0.8]]);
    const { byte, fellBack } = edgeBandByte(cellRiskMap, ['c1', 'c2'], { c1: 1, c2: 3 }, 'Morning', 0.5);
    expect(byte).toBe(166);
    expect(fellBack).toBe(false);
  });

  it('patchRiskBytes writes bytes for given edges into pre-allocated buffer', () => {
    const cellRiskMap = new Map([['c1:Morning', 0.2], ['c1:Afternoon', 0.6], ['c1:Evening', 0.4], ['c1:Night', 0.8]]);
    const outBytes = new Uint8Array(4 * 4).fill(128);
    const edges = [{ serial: 0, cells: ['c1'], cellWeights: { c1: 1 } }];
    const { fallbackBandCount } = patchRiskBytes(edges, cellRiskMap, 0.5, outBytes);
    expect(fallbackBandCount).toBe(0);
    expect(outBytes[0]).toBe(roundByte(0.2));
    expect(outBytes[1]).toBe(roundByte(0.6));
    expect(outBytes[2]).toBe(roundByte(0.4));
    expect(outBytes[3]).toBe(roundByte(0.8));
    expect(outBytes[4]).toBe(128);
    expect(outBytes[7]).toBe(128);
  });

  it('computeEdgeRiskBytes throws EDGE_RISK_NO_CELLRISK when CellRisk empty', () => {
    expect(() => {
      computeEdgeRiskBytes([{ serial: 0, cells: ['c1'] }], new Map(), 0.5);
    }).toThrow('EDGE_RISK_NO_CELLRISK');
  });

  it('computeEdgeRiskBytes computes all edges and returns fallback counts', () => {
    const cellRiskMap = new Map([
      ['c1:Morning', 0.2], ['c1:Afternoon', 0.6], ['c1:Evening', 0.4], ['c1:Night', 0.8],
      ['c2:Morning', 0.1], ['c2:Afternoon', 0.3], ['c2:Evening', 0.5], ['c2:Night', 0.7],
    ]);
    const edges = [
      { serial: 0, cells: ['c1'], cellWeights: { c1: 2 } },
      { serial: 1, cells: ['c2'], cellWeights: { c2: 2 } },
      { serial: 2, cells: ['c3'], cellWeights: null },
    ];
    const { bytes, fallbackEdgeCount, fallbackBandCount } = computeEdgeRiskBytes(edges, cellRiskMap, 0.5);
    expect(bytes.length).toBe(12);
    expect(fallbackEdgeCount).toBe(1);
    expect(fallbackBandCount).toBe(4);
  });

  it('decodeCellRiskMap builds lookup map from CellRisk docs', () => {
    const docs = [
      { h3: 'c1', band: 'Morning', risk: 0.2 },
      { h3: 'c1', band: 'Afternoon', risk: 0.6 },
    ];
    const map = decodeCellRiskMap(docs);
    expect(map.get('c1:Morning')).toBe(0.2);
    expect(map.get('c1:Afternoon')).toBe(0.6);
    expect(map.has('c1:Evening')).toBe(false);
  });

  it('computeRiskStats returns per-band percentiles and city-mean counts', () => {
    const bytes = new Uint8Array([
      10, 128, 0, 0,
      50, 128, 0, 0,
      100, 128, 0, 0,
      128, 128, 0, 0,
    ]);
    const stats = computeRiskStats(4, bytes, 128);
    expect(stats.perBand.length).toBe(4);
    const morning = stats.perBand[0];
    expect(morning.min).toBe(10);
    expect(morning.max).toBe(128);
    expect(morning.countCityMean).toBe(1);
    const afternoon = stats.perBand[1];
    expect(afternoon.min).toBe(128);
    expect(afternoon.max).toBe(128);
    expect(afternoon.countCityMean).toBe(4);
    expect(afternoon.distinct).toBe(1);
  });
});

describe('20-edge length-weighted spot check', () => {
  it('matches independently computed length-weighted risk within 1/255', () => {
    // Build a cellRiskMap with known values
    const cellRiskMap = new Map();
    for (let i = 0; i < 20; i++) {
      for (const band of BANDS) {
        cellRiskMap.set(`c${i}:${band}`, (i + 1) / 25);
      }
    }

    // Create 20 edge descriptors with known cells and weights
    const edges = [];
    for (let i = 0; i < 20; i++) {
      const cell = `c${i}`;
      edges.push({ serial: i, id: `e${i}`, cells: [cell], cellWeights: { [cell]: 1 } });
    }

    // Compute risk bytes using our shared function
    const { bytes } = computeEdgeRiskBytes(edges, cellRiskMap, 0.5);

    // Verify each edge's bands using the same edgeBandByte logic (independent computation)
    for (let i = 0; i < 20; i++) {
      for (let b = 0; b < BANDS.length; b++) {
        const band = BANDS[b];
        const expectedRisk = (i + 1) / 25;
        const expectedByte = Math.max(0, Math.min(255, Math.round(expectedRisk * 255)));
        const actualByte = bytes[i * 4 + b];
        const diff = Math.abs(actualByte - expectedByte);
        expect(diff).toBeLessThanOrEqual(1);
      }
    }
  });
});
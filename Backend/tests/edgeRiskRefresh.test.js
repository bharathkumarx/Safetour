import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
const outputPath = 'tests/fixtures/edge-risk-refresh.bin';
afterAll(async () => { await fs.rm(outputPath, { force: true }); });

vi.mock('../src/models/CellRisk.js', () => ({
  Metadata: { findOne: () => ({ lean: async () => ({ graphVersion: 'g1' }) }), updateOne: vi.fn(async () => {}) },
  CellRisk: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));
vi.mock('../src/services/dataStore.js', () => ({
  getDataStore: () => ({
    metadata: { cityMeanRisk: 0.4 },
    routing: { drive: { edges: [
      { id: 'e1', cells: ['c1'], cellWeights: { c1: 2 } },
      { id: 'e2', cells: ['c2'], cellWeights: { c2: 2 } },
    ] } },
    cellRisks: new Map([
      ['c1:Morning', { risk: 0.2 }],
      ['c1:Afternoon', { risk: 0.6 }],
    ]),
  }),
}));
vi.mock('../src/routing/graph.js', () => ({ edgesForCells: () => [{ id: 'e1', cells: ['c1'], cellWeights: { c1: 2 } }] }));

describe('edge risk refresh', () => {
  it('writes all bands with city fallback and weighted CellRisk values', async () => {
    const { refreshEdgeRisks } = await import('../src/services/edgeRiskRefresh.js');
    const result = await refreshEdgeRisks(['c1'], { outputPath });
    const artifact = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    expect(result.refreshed).toBe(1);
    expect(artifact.risks.e1.Morning).toBe(0.2);
    expect(artifact.risks.e1.Night).toBe(0.4);
  });

  it('changes only edges touching affected cells', async () => {
    const { refreshEdgeRisks } = await import('../src/services/edgeRiskRefresh.js');
    const initial = {
      graphVersion: 'old',
      risks: {
        e1: { Night: 0.1 },
        e2: { Night: 0.9 },
      },
    };
    await fs.writeFile(outputPath, JSON.stringify(initial));
    await refreshEdgeRisks(['c1'], { outputPath });
    const artifact = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    expect(artifact.risks.e1.Night).toBe(0.4);
    expect(artifact.risks.e2.Night).toBe(0.9);
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import { buildOverpassQuery, parseOverpass, tileBboxes, fetchOverpassTile, resetEndpointState, cachePathForTile, overpassStatus } from '../src/services/overpass.js';
import { validateOverpassUserAgent } from '../src/config/env.js';
import { buildRoutingGraph, graphInfo, loadRoutingGraph, nearestNode, edgeRisk } from '../src/routing/graph.js';
import { buildGraphs, largestScc } from '../scripts/buildGraph.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const fixtureDir = path.resolve('tests/fixtures/graph-artifacts');
afterAll(async () => { await fs.rm(fixtureDir, { recursive: true, force: true }); });

describe('Overpass and routing graph', () => {
  it('uses the required mode filters and creates 16 tiles', () => {
    expect(buildOverpassQuery([1, 2, 3, 4], 'drive')).toContain('residential');
    expect(buildOverpassQuery([1, 2, 3, 4], 'drive')).not.toContain('|service');
    expect(buildOverpassQuery([1, 2, 3, 4], 'walk')).toContain('footway');
    expect(tileBboxes([1, 2, 3, 4])).toHaveLength(16);
    const parsed = parseOverpass({ elements: [
      { type: 'node', id: 1, lat: 12.9, lon: 77.6 },
      { type: 'node', id: 2, lat: 12.901, lon: 77.6 },
      { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'service', access: 'private' } },
    ] });
    expect(parsed.ways).toHaveLength(0);
  });

  it('builds directed geometry edges and loads both modes without Mongo', async () => {
    const data = { nodes: [{ id: 'a', lat: 12.9, lng: 77.6 }, { id: 'b', lat: 12.901, lng: 77.6 }], ways: [{ id: 'w', nodes: ['a', 'b'], tags: { highway: 'residential', oneway: 'yes' }, mode: 'drive' }] };
    const built = buildRoutingGraph(data);
    expect(built.edges).toHaveLength(1);
    await fs.mkdir(fixtureDir, { recursive: true });
    for (const mode of ['drive', 'walk']) {
      await fs.writeFile(path.join(fixtureDir, `${mode}.json`), JSON.stringify({ ...data, graphVersion: mode }));
      await fs.writeFile(path.join(fixtureDir, `${mode}.bin`), JSON.stringify({ risks: { [built.edges[0].id]: { Morning: 0.2 } } }));
      await loadRoutingGraph({ mode, graphPath: path.join(fixtureDir, `${mode}.json`), riskPath: path.join(fixtureDir, `${mode}.bin`) });
      expect(graphInfo(mode).edges).toBe(1);
      expect(edgeRisk(built.edges[0].id, 'Morning', mode)).toBe(0.2);
    }
    expect(() => nearestNode(10, 70, 'drive')).toThrowError(/No road nearby/);
  });

  it('keeps walk ways bidirectional even when oneway or roundabout tagged', () => {
    const data = {
      nodes: [{ id: 'a', lat: 12.9, lng: 77.6 }, { id: 'b', lat: 12.901, lng: 77.6 }],
      ways: [{ id: 'walk-oneway', nodes: ['a', 'b'], tags: { highway: 'footway', oneway: 'yes', junction: 'roundabout' }, mode: 'walk' }],
    };
    const graph = buildRoutingGraph(data);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual(['a->b', 'b->a']);
  });

  it('honours Retry-After and grows exponential backoff without network access', async () => {
    resetEndpointState();
    const waits = [];
    let posts = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('/status')) return { ok: true };
      posts += 1;
      if (posts === 1) return { ok: false, status: 429, headers: { get: () => '7' } };
      return { ok: true, json: async () => ({ elements: [] }) };
    };
    await fetchOverpassTile([1, 2, 3, 4], {
      endpoints: ['https://example.test/api/interpreter'], cacheDir: fixtureDir, fetchImpl, paceMs: 0,
      sleepImpl: async (ms) => waits.push(ms),
    });
    expect(waits[0]).toBe(7000);

    posts = 0; waits.length = 0; resetEndpointState();
    const alwaysFail = async (url) => (url.endsWith('/status') ? { ok: true } : { ok: false, status: 500 });
    await expect(fetchOverpassTile([1, 2, 3, 5], {
      endpoints: ['https://example.test/api/interpreter'], cacheDir: fixtureDir, fetchImpl: alwaysFail, paceMs: 0,
      sleepImpl: async (ms) => waits.push(ms),
    })).rejects.toThrow(/tile failed/);
    expect(waits.length).toBe(7);
    expect(waits[0]).toBeGreaterThanOrEqual(7500);
    expect(waits[0]).toBeLessThanOrEqual(22500);
    expect(waits[1]).toBeGreaterThanOrEqual(15000);
    expect(waits[1]).toBeLessThanOrEqual(45000);
  });

  it('checks status and preserves cached tiles with atomic cache writes', async () => {
    resetEndpointState();
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return url.endsWith('/status')
        ? { ok: true }
        : { ok: true, json: async () => ({ elements: [{ type: 'node', id: 1, lat: 12.9, lon: 77.6 }] }) };
    };
    const bbox = [2, 3, 4, 5];
    await fetchOverpassTile(bbox, { endpoints: ['https://example.test/api/interpreter'], cacheDir: fixtureDir, fetchImpl, paceMs: 0 });
    expect(calls).toEqual(['https://example.test/api/status', 'https://example.test/api/interpreter']);
    calls.length = 0;
    await fetchOverpassTile(bbox, { endpoints: ['https://example.test/api/interpreter'], cacheDir: fixtureDir, fetchImpl, paceMs: 0 });
    expect(calls).toHaveLength(0);
    expect(await fs.access(cachePathForTile(bbox, 'drive', fixtureDir))).toBeUndefined();
    expect((await fs.readdir(fixtureDir)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('refuses a partial graph unless explicitly allowed', async () => {
    await expect(buildGraphs({ modes: [], selectedTiles: [3], outputDir: fixtureDir })).rejects.toThrow(/all 16 tiles/);
  });

  it('rejects missing or example.com user agents', () => {
    expect(() => validateOverpassUserAgent('')).toThrow(/OVERPASS_USER_AGENT/);
    expect(() => validateOverpassUserAgent('SafeTour/0.1 (+https://example.com; mailto:test@example.com)')).toThrow(/example.com/);
    expect(validateOverpassUserAgent('SafeTour/0.1 (+https://safetour.test; mailto:ops@safetour.test)')).toContain('SafeTour/0.1');
  });

  it('treats a 406 HTML status response as advisory and does not block', async () => {
    const logs = [];
    const fetchImpl = async (url) => url.endsWith('/status')
      ? { ok: false, status: 406, text: async () => '<html>Not Acceptable</html>' }
      : { ok: true, status: 200, json: async () => ({ elements: [] }) };
    const result = await overpassStatus({
      endpoints: ['https://example.test/api/interpreter'],
      fetchImpl,
      userAgent: 'SafeTour/0.1 (+https://safetour.test; mailto:ops@safetour.test)',
      logger: (line) => logs.push(line),
    });
    expect(result[0].status).toBe(406);
    expect(logs).toEqual(['status unknown']);
  });

  it('aborts a stalled request using the configured stall timeout', async () => {
    const fetchImpl = async (url, options) => {
      if (url.endsWith('/status')) return { ok: true, status: 200, text: async () => '2 slots available now' };
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };
    await expect(fetchOverpassTile([6, 7, 8, 9], {
      endpoints: ['https://example.test/api/interpreter'],
      cacheDir: fixtureDir,
      fetchImpl,
      paceMs: 0,
      stallMinutes: 0.0001,
      userAgent: 'SafeTour/0.1 (+https://safetour.test; mailto:ops@safetour.test)',
    })).rejects.toMatchObject({ code: 'OVERPASS_STALL' });
  });

  it('computes the largest SCC iteratively for a 300,000-node chain', () => {
    const nodes = [];
    const edges = [];
    for (let i = 0; i < 300000; i += 1) nodes.push({ id: String(i) });
    for (let i = 0; i < 299999; i += 1) edges.push({ from: String(i), to: String(i + 1) });
    const keep = largestScc(nodes, edges);
    expect(keep.size).toBe(1);
  });
});

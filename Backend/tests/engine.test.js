import { describe, expect, it } from 'vitest';
import {
  circularHourDistance,
  createRiskEngine,
  environmentVulnerability,
  kdeAtPoint,
  scorePoint,
  timeWeight,
} from '../src/engine/riskEngine.js';

const point = (overrides = {}) => ({
  location: { coordinates: [77.5946, 12.9716] },
  crimeType: 'Theft',
  severity: 5,
  hour: 12,
  lighting: 0.5,
  cctv: 0.5,
  crowd: 0.5,
  police: 0.5,
  ...overrides,
});

describe('risk engine', () => {
  it('wraps time around midnight', () => {
    expect(circularHourDistance(23, 1)).toBe(2);
    expect(timeWeight(23, 1)).toBeCloseTo(timeWeight(23, 21));
  });

  it('keeps score and risk bounded', () => {
    const result = scorePoint({ lat: 12.9716, lng: 77.5946, incidents: [point({ severity: 10 })] });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.risk).toBeGreaterThanOrEqual(0);
    expect(result.risk).toBeLessThanOrEqual(1);
  });

  it('increases risk monotonically for a more severe incident', () => {
    const low = scorePoint({ lat: 12.9716, lng: 77.5946, incidents: [point({ severity: 1 })] });
    const high = scorePoint({ lat: 12.9716, lng: 77.5946, incidents: [point({ severity: 10 })] });
    expect(high.risk).toBeGreaterThan(low.risk);
  });

  it('shrinks an empty cell to city means', () => {
    const result = scorePoint({
      lat: 12.98,
      lng: 77.65,
      incidents: [point()],
      cityMeanCrime: 0.3,
      cityMeanEnvironment: 0.7,
    });
    expect(result.confidence).toBe(0);
    expect(result.crime).toBeCloseTo(0.3);
    expect(result.environment).toBeCloseTo(0.7);
  });

  it('excludes cybercrime from KDE and local counts', () => {
    const result = scorePoint({
      lat: 12.9716,
      lng: 77.5946,
      incidents: [point({ crimeType: 'Cybercrime', severity: 10 })],
    });
    expect(result.nIncidents).toBe(0);
    expect(kdeAtPoint({
      lat: 12.9716,
      lng: 77.5946,
      incidents: [point({ crimeType: 'Cybercrime', severity: 10 })],
    }).value).toBe(0);
  });

  it('matches the hand-computed neutral environment fixture', () => {
    expect(environmentVulnerability([point()], { isNight: false })).toBeCloseTo(0.5);
  });

  it('creates a reusable high-level engine', () => {
    const engine = createRiskEngine([point()], { allCellCrime: [0, 1] });
    expect(engine.scorePoint({ lat: 12.9716, lng: 77.5946 })).toHaveProperty('score');
    expect(engine.index).toBeDefined();
  });
});

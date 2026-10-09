import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';

describe('query validation with Express 5', () => {
  it('accepts valid heatmap query parameters without mutating req.query', async () => {
    const response = await request(app)
      .get('/api/v1/heatmap')
      .query({ hour: 22, timeBand: 'Night', layer: 'risk' });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe('FeatureCollection');
    expect(response.body.timeBand).toBe('Night');
    expect(response.body.features).toEqual(expect.any(Array));
  });

  it('preserves structured 422 responses for invalid heatmap parameters', async () => {
    const response = await request(app)
      .get('/api/v1/heatmap')
      .query({ hour: 24, layer: 'risk' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(expect.any(Array));
  });
});

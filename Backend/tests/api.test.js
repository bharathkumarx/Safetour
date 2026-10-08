import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';

describe('REST API validation and documentation', () => {
  it('rejects coordinates outside Bangalore with structured details', async () => {
    const response = await request(app).get('/api/v1/score').query({ lat: 10, lng: 77.6 });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(expect.any(Array));
  });

  it('exposes OpenAPI documentation', async () => {
    const response = await request(app).get('/api/docs/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger-ui');
  });

  it('returns a JSON error for unknown endpoints', async () => {
    const response = await request(app).get('/api/v1/no-such-endpoint');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';

describe('GET /api/v1/health', () => {
  it('returns service health and data version', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', dataVersion: 'demo-2026-01' });
  });
});

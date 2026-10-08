import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { Incident } from '../src/models/Incident.js';
import { Metadata } from '../src/models/CellRisk.js';
import { ingestRows } from '../src/services/incidentIngestion.js';
import { csvSource } from '../src/services/incidentSource.js';

const row = (overrides = {}) => ({
  latitude: '12.9352',
  longitude: '77.6245',
  crime_type: 'Robbery',
  crime_severity: '8',
  date: '2026-10-06',
  time: '21:00',
  hour: '21',
  area: 'Koramangala',
  lighting_score: '0.3',
  cctv_score: '0.4',
  crowd_density: '0.6',
  police_proximity: '0.3',
  is_night: '1',
  ...overrides,
});

let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  await Incident.deleteMany({});
  await Metadata.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('incident ingestion', () => {
  it('drops invalid coordinates, severity, and time with reasons', async () => {
    const result = await ingestRows(
      [row({ latitude: '12.7' }), row({ crime_severity: '11' }), row({ time: '25:00' })],
      { source: 'demo' },
    );
    expect(result.kept).toBe(0);
    expect(result.droppedByReason).toEqual({ latitude: 1, crime_severity: 1, time: 1 });
  });

  it('is idempotent and stores cybercrime as excluded', async () => {
    const first = await ingestRows([row(), row({ crime_type: 'Cybercrime', time: '22:00', hour: '22' })], {
      source: 'demo',
    });
    const second = await ingestRows([row(), row({ crime_type: 'Cybercrime', time: '22:00', hour: '22' })], {
      source: 'demo',
    });
    expect(first.inserted).toBe(2);
    expect(first.excluded).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(await Incident.countDocuments({ excluded: true })).toBe(1);
  });

  it('skips a duplicate of a baseline row across sources', async () => {
    expect((await ingestRows([row()], { source: 'baseline' })).inserted).toBe(1);
    const result = await ingestRows([row()], { source: 'demo' });
    expect(result.inserted).toBe(0);
    expect(result.duplicates).toBe(1);
  });

  it('updates freshness and only advances dataVersion on insert', async () => {
    const first = await ingestRows([row()], { source: 'demo' });
    const second = await ingestRows([row()], { source: 'demo' });
    const metadata = await Metadata.findOne({}).lean();
    expect(first.dataVersion).toMatch(/\+1$/);
    expect(second.dataVersion).toBe(first.dataVersion);
    expect(metadata.incidentCount).toBe(1);
    expect(metadata.latestIncidentAt).toEqual(new Date('2026-10-06T21:00:00.000Z'));
  });
});

describe('csv source', () => {
  it('auto-detects comma and tab delimiters', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'safetour-'));
    const headers = Object.keys(row());
    const values = Object.values(row());
    const commaPath = path.join(directory, 'comma.csv');
    const tabPath = path.join(directory, 'tab.csv');
    await fs.writeFile(commaPath, `${headers.join(',')}\n${values.join(',')}\n`);
    await fs.writeFile(tabPath, `${headers.join('\t')}\n${values.join('\t')}\n`);
    expect((await Array.fromAsync(csvSource.fetchRows({ filePath: commaPath })))[0].crime_type).toBe('Robbery');
    expect((await Array.fromAsync(csvSource.fetchRows({ filePath: tabPath })))[0].crime_type).toBe('Robbery');
  });
});

it('protects the immutable baseline checksum', async () => {
  const csv = await fs.readFile(path.resolve(process.cwd(), '../Data/bangalore_crime_dataset.csv'));
  const expected = (await fs.readFile(path.resolve(process.cwd(), 'tests/fixtures/baseline.sha256'), 'utf8')).trim();
  expect(crypto.createHash('sha256').update(csv).digest('hex')).toBe(expected);
});


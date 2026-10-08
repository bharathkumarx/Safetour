import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Metadata } from '../models/CellRisk.js';

const baselinePath = path.resolve(process.cwd(), '../Data/bangalore_crime_dataset.csv');

async function baselineHash() {
  const contents = await fs.readFile(baselinePath);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

/** Return the singleton metadata document in the API freshness shape. */
export async function getDataFreshness() {
  const metadata = await Metadata.findOne({}).lean();
  if (!metadata) return null;
  return {
    dataVersion: metadata.dataVersion,
    recencyReferenceAt: metadata.recencyReferenceAt,
    latestIncidentAt: metadata.latestIncidentAt,
    lastIngestedAt: metadata.lastIngestedAt,
    historicalDataStart: metadata.historicalDataStart,
    historicalDataEnd: metadata.historicalDataEnd,
    isSynthetic: metadata.isSynthetic,
    incidentCount: metadata.incidentCount,
    dataThrough: metadata.latestIncidentAt,
  };
}

export async function getBaselineHash() {
  return baselineHash();
}


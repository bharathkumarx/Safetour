import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import { latLngToCell } from 'h3-js';
import { env } from '../src/config/env.js';
import { EXCLUDED_CRIME_TYPES, RECENCY_HALF_LIFE_DAYS } from '../src/config/constants.js';
import { Incident } from '../src/models/Incident.js';
import { Metadata } from '../src/models/CellRisk.js';
import { validateIncidentRow } from '../src/services/incidentSchema.js';

const datasetPath = path.resolve(process.cwd(), '../Data/bangalore_crime_dataset.csv');
function getTimeBand(hour) {
  if (hour >= 5 && hour < 11) return 'Morning';
  if (hour >= 11 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 20) return 'Evening';
  return 'Night';
}

export async function readDataset(filePath = datasetPath) {
  const csv = await fs.readFile(filePath, 'utf8');
  const delimiter = csv.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const rows = parse(csv, { columns: true, skip_empty_lines: true, delimiter, relax_column_count: true });
  const reasons = new Map();
  const dropped = [];
  const validRows = [];
  for (const row of rows) {
    const result = validateIncidentRow(row);
    if (!result.success) {
      reasons.set(result.reason, (reasons.get(result.reason) || 0) + 1);
      dropped.push(row);
      continue;
    }
    validRows.push(result.data);
  }
  const newest = validRows.reduce((latest, row) => (row.date > latest ? row.date : latest), validRows[0]?.date || '1970-01-01');
  const newestDate = new Date(`${newest}T00:00:00.000Z`);
  const incidents = validRows.map((row) => {
    const timestamp = new Date(`${row.date}T${row.time}:00.000Z`);
    const days = Math.max(0, (newestDate - timestamp) / 86400000);
    const source = 'baseline';
    const identity = `${timestamp.toISOString()}|${row.crime_type}|${row.latitude.toFixed(5)}|${row.longitude.toFixed(5)}|${row.crime_severity.toFixed(1)}`;
    return {
      location: { type: 'Point', coordinates: [row.longitude, row.latitude] },
      crimeType: row.crime_type,
      severity: row.crime_severity,
      timestamp,
      hour: row.hour,
      timeBand: getTimeBand(row.hour),
      area: row.area,
      lighting: row.lighting_score,
      cctv: row.cctv_score,
      crowd: row.crowd_density,
      police: row.police_proximity,
      isNight: row.is_night,
      h3r9: latLngToCell(row.latitude, row.longitude, 9),
      recencyWeight: 2 ** (-days / RECENCY_HALF_LIFE_DAYS),
      excluded: EXCLUDED_CRIME_TYPES.includes(row.crime_type),
      source,
      fingerprint: crypto.createHash('sha1').update(identity).digest('hex'),
      ingestedAt: new Date(),
    };
  });
  return { incidents, dropped, reasons, newestDate, hash: crypto.createHash('sha256').update(csv).digest('hex'), rowCount: rows.length };
}

function printSummary(incidents, dropped, reasons, newestDate) {
  const counts = (key) => {
    const grouped = incidents.reduce((result, row) => {
      result[row[key]] = (result[row[key]] || 0) + 1;
      return result;
    }, {});
    return Object.entries(grouped).map(([name, count]) => `${name}: ${count}`);
  };
  console.log(`Rows: ${incidents.length} kept, ${dropped.length} dropped`);
  console.log(`Dropped by reason: ${JSON.stringify(Object.fromEntries(reasons))}`);
  console.log(`Crime types: ${counts('crimeType').join(', ')}`);
  console.log(`Areas: ${counts('area').join(', ')}`);
  const dates = incidents.map((row) => row.timestamp).sort((a, b) => a - b);
  console.log(`Date range: ${dates[0]?.toISOString().slice(0, 10)} to ${newestDate.toISOString().slice(0, 10)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await readDataset();
  await mongoose.connect(env.MONGODB_URI);
  await Incident.deleteMany({});
  await Incident.insertMany(data.incidents);
  const timestamps = data.incidents.map((incident) => incident.timestamp.getTime());
  const reference = new Date(Math.max(...timestamps));
  await Metadata.findOneAndUpdate(
    {},
    {
      baselineHash: data.hash,
      ingestSequence: 0,
      dataVersion: `${data.hash}+0`,
      recencyReferenceAt: reference,
      latestIncidentAt: reference,
      lastIngestedAt: new Date(),
      historicalDataStart: new Date(Math.min(...timestamps)),
      historicalDataEnd: reference,
      isSynthetic: true,
      incidentCount: data.incidents.length,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  printSummary(data.incidents, data.dropped, data.reasons, data.newestDate);
  await mongoose.disconnect();
}

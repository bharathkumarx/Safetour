import crypto from 'node:crypto';
import { latLngToCell } from 'h3-js';
import { EXCLUDED_CRIME_TYPES, RECENCY_HALF_LIFE_DAYS } from '../config/constants.js';
import { Incident } from '../models/Incident.js';
import { Metadata } from '../models/CellRisk.js';
import { getBaselineHash } from './dataFreshness.js';
import { validateIncidentRow } from './incidentSchema.js';

const DAY_MS = 86400000;

function timeBand(hour) {
  if (hour >= 5 && hour < 11) return 'Morning';
  if (hour >= 11 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 20) return 'Evening';
  return 'Night';
}

function fingerprintFor({ source, sourceRecordId, timestamp, crimeType, latitude, longitude, severity }) {
  const identity = sourceRecordId
    ? `${source}|${sourceRecordId}`
    : `${new Date(timestamp).toISOString()}|${crimeType}|${latitude.toFixed(5)}|${longitude.toFixed(5)}|${severity.toFixed(1)}`;
  return crypto.createHash('sha1').update(identity).digest('hex');
}

function normalize(row, source, recencyReferenceAt, ingestedAt) {
  const timestamp = new Date(`${row.date}T${row.time}:00.000Z`);
  const ageDays = Math.max(0, (recencyReferenceAt.getTime() - timestamp.getTime()) / DAY_MS);
  const isNight = row.is_night ?? (row.hour >= 20 || row.hour < 5 ? 1 : 0);
  const sourceRecordId = row.source_record_id;
  return {
    location: { type: 'Point', coordinates: [row.longitude, row.latitude] },
    crimeType: row.crime_type,
    severity: row.crime_severity,
    timestamp,
    hour: row.hour,
    timeBand: timeBand(row.hour),
    area: row.area,
    lighting: row.lighting_score,
    cctv: row.cctv_score,
    crowd: row.crowd_density,
    police: row.police_proximity,
    isNight,
    h3r9: latLngToCell(row.latitude, row.longitude, 9),
    recencyWeight: 2 ** (-ageDays / RECENCY_HALF_LIFE_DAYS),
    excluded: EXCLUDED_CRIME_TYPES.includes(row.crime_type),
    source,
    ...(sourceRecordId ? { sourceRecordId } : {}),
    fingerprint: fingerprintFor({
      source,
      sourceRecordId,
      timestamp,
      crimeType: row.crime_type,
      latitude: row.latitude,
      longitude: row.longitude,
      severity: row.crime_severity,
    }),
    ingestedAt,
  };
}

async function initialReference() {
  const latestBaseline = await Incident.findOne({ source: 'baseline' }).sort({ timestamp: -1 }).select('timestamp').lean();
  return latestBaseline?.timestamp ?? new Date(0);
}

function errorIndex(error) {
  return new Set((error.writeErrors || []).map((item) => item.index));
}

/**
 * Validate, deduplicate, normalize, and insert incidents from any row source.
 * If is_night is absent, it falls back to the hour-based night calculation.
 */
export async function ingestRows(rows, { source = 'unknown', dryRun = false } = {}) {
  const inputRows = [];
  for await (const row of rows) inputRows.push(row);
  const droppedByReason = {};
  const validRows = [];
  for (const row of inputRows) {
    const result = validateIncidentRow(row);
    if (!result.success) {
      droppedByReason[result.reason] = (droppedByReason[result.reason] || 0) + 1;
      continue;
    }
    validRows.push(result.data);
  }

  const metadata = await Metadata.findOne({}).lean();
  const recencyReferenceAt = metadata?.recencyReferenceAt ?? (await initialReference());
  const ingestedAt = new Date();
  const normalized = validRows.map((row) => normalize(row, source, new Date(recencyReferenceAt), ingestedAt));
  const uniqueNormalized = [];
  const inputFingerprints = new Set();
  for (const incident of normalized) {
    if (!inputFingerprints.has(incident.fingerprint)) uniqueNormalized.push(incident);
    inputFingerprints.add(incident.fingerprint);
  }
  const fingerprints = [...inputFingerprints];
  const existing = fingerprints.length
    ? await Incident.find({ fingerprint: { $in: fingerprints } }).select('fingerprint').lean()
    : [];
  const existingFingerprints = new Set(existing.map((incident) => incident.fingerprint));
  const candidates = uniqueNormalized.filter((incident) => !existingFingerprints.has(incident.fingerprint));

  let insertedIncidents = [];
  const raceDuplicates = new Set();
  if (candidates.length && !dryRun) {
    try {
      const result = await Incident.bulkWrite(
        candidates.map((document) => ({ insertOne: { document } })),
        { ordered: false },
      );
      const insertedCount = result.insertedCount ?? result.nInserted ?? candidates.length;
      insertedIncidents = candidates.slice(0, insertedCount);
    } catch (error) {
      if (error?.code !== 11000 && !error?.writeErrors) throw error;
      for (const index of error.writeErrors || []) {
        if (index.code === 11000) raceDuplicates.add(index.index);
      }
      insertedIncidents = candidates.filter((_, index) => !raceDuplicates.has(index));
    }
  }

  const inserted = insertedIncidents.length;
  const duplicates = normalized.length - candidates.length + raceDuplicates.size;
  const allIncidents = inserted
    ? await Incident.find({}).select('timestamp').lean()
    : null;
  if (inserted && !dryRun) {
    const timestamps = allIncidents.map((incident) => new Date(incident.timestamp));
    const baselineHash = metadata?.baselineHash ?? (await getBaselineHash());
    const ingestSequence = (metadata?.ingestSequence ?? 0) + 1;
    await Metadata.findOneAndUpdate(
      {},
      {
        baselineHash,
        ingestSequence,
        dataVersion: `${baselineHash}+${ingestSequence}`,
        recencyReferenceAt,
        latestIncidentAt: new Date(Math.max(...timestamps.map((date) => date.getTime()))),
        lastIngestedAt: ingestedAt,
        historicalDataStart: new Date(Math.min(...timestamps.map((date) => date.getTime()))),
        historicalDataEnd: new Date(Math.max(...timestamps.map((date) => date.getTime()))),
        isSynthetic: true,
        incidentCount: allIncidents.length,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  return {
    inputRows: inputRows.length,
    kept: validRows.length,
    droppedByReason,
    inserted: dryRun ? 0 : inserted,
    duplicates,
    excluded: (dryRun ? candidates : insertedIncidents).filter((incident) => incident.excluded).length,
    insertedIncidents: dryRun ? [] : insertedIncidents,
    latestIncidentAt: inserted
      ? new Date(Math.max(...(allIncidents ?? normalized).map((incident) => new Date(incident.timestamp).getTime())))
      : metadata?.latestIncidentAt,
    dataVersion: inserted ? `${metadata?.baselineHash ?? (await getBaselineHash())}+${(metadata?.ingestSequence ?? 0) + 1}` : metadata?.dataVersion,
  };
}

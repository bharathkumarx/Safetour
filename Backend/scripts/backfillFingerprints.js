import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Incident } from '../src/models/Incident.js';

const fingerprint = (incident) => {
  const [lng, lat] = incident.location.coordinates;
  const timestamp = new Date(incident.timestamp);
  timestamp.setSeconds(0, 0);
  const source = incident.source || 'baseline';
  const identity = incident.sourceRecordId
    ? `${source}|${incident.sourceRecordId}`
    : `${timestamp.toISOString()}|${incident.crimeType}|${lat.toFixed(5)}|${lng.toFixed(5)}|${incident.severity.toFixed(1)}`;
  return crypto.createHash('sha1').update(identity).digest('hex');
};

await mongoose.connect(env.MONGODB_URI);
const incidents = await Incident.find({});
let updated = 0;
for (const incident of incidents) {
  const currentSource = incident.source || 'baseline';
  const value = fingerprint(incident);
  if (incident.fingerprint !== value || incident.source !== currentSource) {
    incident.source = currentSource;
    incident.fingerprint = value;
    incident.ingestedAt = incident.ingestedAt || new Date();
    await incident.save();
    updated += 1;
  }
}
console.log(`Backfilled fingerprints: ${updated}/${incidents.length}`);
await mongoose.disconnect();

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Incident } from '../src/models/Incident.js';
import { Metadata } from '../src/models/CellRisk.js';
import { createRiskEngine } from '../src/engine/riskEngine.js';

const candidates = [
  ['Koramangala', 12.93127653125, 77.62354347917],
  ['Whitefield', 12.96989206061, 77.74880839394],
  ['Yelahanka', 13.10078025373, 77.59823047761],
  ['Hebbal', 13.03412068254, 77.59509911111],
  ['Rajajinagar', 12.99286397674, 77.55280844186],
  ['Jayanagar', 12.92733823077, 77.58257975385],
  ['Indiranagar', 12.9698475, 77.64329460638],
  ['Electronic City', 12.842737625, 77.66171682813],
  ['HSR Layout', 12.9116, 77.6389],
  ['Marathahalli', 12.95820481, 77.69592284002],
  ['Domlur', 12.96146352222, 77.63935802222],
  ['Banashankari', 12.9255, 77.5468],
  ['Malleshwaram', 13.005, 77.57],
  ['Yeshwanthpur', 13.028, 77.54],
  ['KR Puram', 13.007, 77.695],
];

execFileSync('node', [path.resolve(process.cwd(), 'scripts/demoReset.js')], { stdio: 'inherit' });
await mongoose.connect(env.MONGODB_URI);
const incidents = await Incident.find({}).lean();
const metadata = await Metadata.findOne({}).lean();
const engine = createRiskEngine(incidents, {
  allCellCrime: metadata.percentileReferences?.Night ?? metadata.percentileReference,
  allCellCrimeSorted: true,
  cityMeanCrime: metadata.cityMeanRisk,
});
console.table(
  candidates.map(([place, lat, lng]) => {
    const result = engine.scorePoint({ lat, lng, hour: 22 });
    return {
      place,
      lat,
      lng,
      score: result.score,
      C: result.crime,
      E: result.environment,
      confidence: result.confidence,
      nNearby: result.nNearby,
    };
  }),
);
const labels = (score) =>
  score >= 80 ? 'Very Safe' : score >= 65 ? 'Safe' : score >= 50 ? 'Moderate' : score >= 35 ? 'Caution' : 'High Caution';
for (const band of ['Morning', 'Afternoon', 'Evening', 'Night']) {
  const rows = await (await import('../src/models/CellRisk.js')).CellRisk.find({ band }).select({ score: 1, nIncidents: 1, _id: 0 }).lean();
  const covered = rows.filter((row) => row.nIncidents > 0);
  console.log(
    `${band} covered histogram:`,
    Object.fromEntries(['Very Safe', 'Safe', 'Moderate', 'Caution', 'High Caution'].map((label) => [
      label,
      covered.filter((row) => labels(row.score) === label).length,
    ])),
  );
}
await mongoose.disconnect();

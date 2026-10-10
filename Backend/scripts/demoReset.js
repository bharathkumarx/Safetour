import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Incident } from '../src/models/Incident.js';
import { Metadata } from '../src/models/CellRisk.js';
import { affectedCellsFor, refreshAffectedCells } from '../src/services/riskRefresh.js';
import { onCellsChanged } from '../src/services/riskEvents.js';
import { registerEdgeRiskRefresh } from '../src/services/edgeRiskRefresh.js';
import { loadRoutingGraph } from '../src/routing/graph.js';

await mongoose.connect(env.MONGODB_URI);
onCellsChanged(registerEdgeRiskRefresh());
try {
  await loadRoutingGraph({ mode: 'drive' });
} catch (error) {
  if (error.code === 'ENOENT') console.log('graph unavailable, edge refresh skipped');
  else throw error;
}
const demoIncidents = await Incident.find({ source: 'demo' }).lean();
const cellIds = affectedCellsFor(demoIncidents).map((cell) => cell.h3);
await Incident.deleteMany({ source: 'demo' });
const refresh = cellIds.length ? await refreshAffectedCells([], { cellIds }) : { affectedCells: 0, refreshedRecords: 0, hookResults: [] };

const remaining = await Incident.find({}).select('timestamp').lean();
const metadata = await Metadata.findOne({}).lean();
const timestamps = remaining.map((incident) => new Date(incident.timestamp).getTime());
const newestBaseline = await Incident.findOne({ source: 'baseline' }).sort({ timestamp: -1 }).select('timestamp').lean();
const recencyReferenceAt = newestBaseline?.timestamp ?? metadata?.recencyReferenceAt;
if (recencyReferenceAt) {
  await Incident.updateMany(
    {},
    [
      {
        $set: {
          recencyWeight: {
            $pow: [
              2,
              {
                $divide: [
                  {
                    $multiply: [
                      -1,
                      {
                        $max: [
                          0,
                          {
                            $divide: [
                              { $subtract: [recencyReferenceAt, '$timestamp'] },
                              86400000,
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  365,
                ],
              },
            ],
          },
        },
      },
    ],
    { updatePipeline: true },
  );
}
if (metadata && timestamps.length) {
  await Metadata.findOneAndUpdate(
    {},
    {
      $set: {
        ingestSequence: 0,
        dataVersion: `${metadata.baselineHash}+0`,
        recencyReferenceAt,
        latestIncidentAt: new Date(Math.max(...timestamps)),
        lastIngestedAt: metadata.lastIngestedAt,
        historicalDataStart: new Date(Math.min(...timestamps)),
        historicalDataEnd: new Date(Math.max(...timestamps)),
        incidentCount: remaining.length,
      },
    },
    { new: true },
  );
}
console.log(`Removed demo incidents: ${demoIncidents.length}`);
console.log(`Refreshed affected H3 cells: ${cellIds.length}`);
const edgeResult = refresh.hookResults?.find((result) => result?.totalEdges !== undefined);
if (edgeResult) {
  console.log(`affected edges: ${edgeResult.refreshed} of ${edgeResult.totalEdges} (${((edgeResult.refreshed / edgeResult.totalEdges) * 100).toFixed(2)}%)`);
  console.log(`edge risk file updated: ${edgeResult.edgeRiskFileUpdated ? 'yes' : 'no'}`);
  console.log(`graphVersion: ${edgeResult.graphVersion}`);
}
await mongoose.disconnect();

import { CellRisk, Metadata } from '../models/CellRisk.js';
import { Incident } from '../models/Incident.js';
import { createSpatialIndex } from '../engine/spatialIndex.js';
import { loadRoutingGraph } from '../routing/graph.js';

let state = {
  incidents: [],
  index: createSpatialIndex([]),
  cellRisks: new Map(),
  metadata: null,
  dataVersion: null,
  graphVersion: null,
  routing: null,
};

export async function reload() {
  const [incidents, risks] = await Promise.all([Incident.find({}).lean(), CellRisk.find({}).lean()]);
  const nextIndex = createSpatialIndex(incidents.filter((incident) => !incident.excluded));
  const nextCellRisks = new Map(risks.map((risk) => [`${risk.h3}:${risk.band}`, risk]));
  const metadata = await Metadata.findOne({}).lean();
  const routing = {};
  for (const mode of ['drive', 'walk']) {
    try { routing[mode] = await loadRoutingGraph({ mode }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  state = {
    incidents,
    index: nextIndex,
    cellRisks: nextCellRisks,
    metadata,
    dataVersion: metadata?.dataVersion ?? null,
    graphVersion: metadata?.graphVersion ?? null,
    routing,
  };
  return state;
}

export function getDataStore() {
  return state;
}

/** Reload only when the persisted metadata version changed. */
export async function reloadIfChanged() {
  const metadata = await Metadata.findOne({}).select('dataVersion graphVersion').lean();
  if (metadata?.dataVersion !== state.dataVersion || metadata?.graphVersion !== state.graphVersion) return reload();
  return state;
}

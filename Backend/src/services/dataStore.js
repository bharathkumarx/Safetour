import { CellRisk, Metadata } from '../models/CellRisk.js';
import { Incident } from '../models/Incident.js';
import { createSpatialIndex } from '../engine/spatialIndex.js';

let state = { incidents: [], index: createSpatialIndex([]), cellRisks: new Map(), dataVersion: null };

export async function reload() {
  const [incidents, risks] = await Promise.all([Incident.find({}).lean(), CellRisk.find({}).lean()]);
  const nextIndex = createSpatialIndex(incidents.filter((incident) => !incident.excluded));
  const nextCellRisks = new Map(risks.map((risk) => [`${risk.h3}:${risk.band}`, risk]));
  const metadata = await Metadata.findOne({}).lean();
  state = {
    incidents,
    index: nextIndex,
    cellRisks: nextCellRisks,
    dataVersion: metadata?.dataVersion ?? null,
  };
  return state;
}

export function getDataStore() {
  return state;
}

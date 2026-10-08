import mongoose from 'mongoose';

const cellRiskSchema = new mongoose.Schema(
  {
    h3: { type: String, required: true },
    band: { type: String, required: true },
    nIncidents: { type: Number, required: true },
    crime: { type: Number, required: true },
    env: { type: Number, required: true },
    risk: { type: Number, required: true },
    score: { type: Number, required: true },
    confidence: { type: Number, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { timestamps: true },
);

cellRiskSchema.index({ band: 1, h3: 1 }, { unique: true });

const metadataSchema = new mongoose.Schema(
  {
    baselineHash: { type: String, required: true },
    ingestSequence: { type: Number, required: true, default: 0 },
    dataVersion: { type: String, required: true },
    recencyReferenceAt: { type: Date, required: true },
    latestIncidentAt: { type: Date },
    lastIngestedAt: { type: Date },
    historicalDataStart: { type: Date },
    historicalDataEnd: { type: Date },
    isSynthetic: { type: Boolean, required: true, default: true },
    incidentCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export const CellRisk = mongoose.models.CellRisk || mongoose.model('CellRisk', cellRiskSchema);
export const Metadata = mongoose.models.Metadata || mongoose.model('Metadata', metadataSchema);

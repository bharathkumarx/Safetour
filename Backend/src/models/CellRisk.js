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
  { key: { type: String, unique: true, required: true }, value: { type: mongoose.Schema.Types.Mixed } },
  { timestamps: true },
);

export const CellRisk = mongoose.models.CellRisk || mongoose.model('CellRisk', cellRiskSchema);
export const Metadata = mongoose.models.Metadata || mongoose.model('Metadata', metadataSchema);

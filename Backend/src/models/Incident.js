import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema(
  {
    location: {
      type: { type: String, enum: ['Point'], required: true, default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    crimeType: { type: String, required: true },
    severity: { type: Number, required: true, min: 0, max: 10 },
    timestamp: { type: Date, required: true },
    hour: { type: Number, required: true, min: 0, max: 23 },
    timeBand: { type: String, required: true },
    area: { type: String, required: true },
    lighting: { type: Number, required: true, min: 0, max: 1 },
    cctv: { type: Number, required: true, min: 0, max: 1 },
    crowd: { type: Number, required: true, min: 0, max: 1 },
    police: { type: Number, required: true, min: 0, max: 1 },
    isNight: { type: Number, enum: [0, 1], required: true },
    h3r9: { type: String, required: true },
    recencyWeight: { type: Number, required: true, min: 0, max: 1 },
    excluded: { type: Boolean, required: true, default: false, index: true },
  },
  { timestamps: true },
);

incidentSchema.index({ location: '2dsphere' });

export const Incident = mongoose.models.Incident || mongoose.model('Incident', incidentSchema);

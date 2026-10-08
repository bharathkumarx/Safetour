import { z } from 'zod';
import { BANGALORE_BBOX } from '../config/constants.js';

const numeric = (min, max) => z.coerce.number().finite().min(min).max(max);

export const incidentRowSchema = z.object({
  latitude: numeric(BANGALORE_BBOX.minLat, BANGALORE_BBOX.maxLat),
  longitude: numeric(BANGALORE_BBOX.minLng, BANGALORE_BBOX.maxLng),
  crime_type: z.string().trim().min(1),
  crime_severity: numeric(0, 10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  hour: numeric(0, 23).int(),
  area: z.string().trim().min(1),
  lighting_score: numeric(0, 1),
  cctv_score: numeric(0, 1),
  crowd_density: numeric(0, 1),
  police_proximity: numeric(0, 1),
  is_night: z.coerce.number().int().min(0).max(1).optional(),
  source_record_id: z.string().trim().min(1).optional(),
});

export function validateIncidentRow(row) {
  const result = incidentRowSchema.safeParse(row);
  if (!result.success) {
    return {
      success: false,
      reason: result.error.issues[0]?.path.join('.') || 'invalid row',
      error: result.error,
    };
  }
  const parsedDate = new Date(`${result.data.date}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== result.data.date) {
    return { success: false, reason: 'invalid date' };
  }
  return { success: true, data: result.data };
}


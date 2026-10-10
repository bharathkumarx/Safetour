import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  MONGODB_URI: z.string().default('mongodb://localhost:27017/safetour'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATA_VERSION: z.string().default('demo-2026-01'),
  DATA_POLL_SECONDS: z.coerce.number().int().min(0).default(30),
  OVERPASS_URLS: z.string().default('https://overpass-api.de/api/interpreter'),
  OVERPASS_TILE_DELAY_MS: z.coerce.number().int().min(0).default(10000),
  OVERPASS_USER_AGENT: z.string().default(''),
  OVERPASS_STALL_MINUTES: z.coerce.number().positive().default(20),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const env = parsed.data;
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);

export function validateOverpassUserAgent(userAgent = env.OVERPASS_USER_AGENT) {
  if (!userAgent?.trim() || /example\.com/i.test(userAgent)) {
    throw new Error('OVERPASS_USER_AGENT must be set to a real identifying User-Agent (do not use example.com); Overpass requires this to identify responsible clients.');
  }
  return userAgent.trim();
}

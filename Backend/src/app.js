import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { corsOrigins, env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: corsOrigins }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp());

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', dataVersion: env.DATA_VERSION });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

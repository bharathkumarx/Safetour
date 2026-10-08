import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { corsOrigins, env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import { apiRouter } from './routes/api.js';
import { getDataStore } from './services/dataStore.js';
import swaggerUi from 'swagger-ui-express';
import openapi from '../openapi.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: corsOrigins }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp());
app.use('/api/v1', apiRateLimit, apiRouter);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.get('/api/openapi.json', (req, res) => res.json(openapi));

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', dataVersion: getDataStore().dataVersion ?? env.DATA_VERSION });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

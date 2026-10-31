import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './config/env.js';
import { clientDistPath } from './config/paths.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requireAuthentication } from './modules/auth/service.js';
import authRouter from './modules/auth/routes.js';
import usersRouter from './modules/auth/users.js';
import systemRouter from './modules/system/backup.js';
import { requestLogger } from './middleware/request-logger.js';
import clientsRouter from './modules/clients/routes.js';
import maintenanceRouter from './modules/maintenance/routes.js';
import workshopRouter from './modules/workshop/routes.js';
import warehouseRouter from './modules/warehouse/routes.js';
import financeRouter from './modules/finance/routes.js';
import employeesRouter from './modules/employees/routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: env.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'madar-v2' });
});

app.use('/api/auth', authRouter);
app.use('/api', requireAuthentication);
app.use('/api/auth/users', usersRouter);
app.use('/api/system', systemRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/workshop', workshopRouter);
app.use('/api/warehouse', warehouseRouter);
app.use('/api/finance', financeRouter);
app.use('/api/employees', employeesRouter);

if (existsSync(join(clientDistPath, 'index.html'))) {
  app.use(express.static(clientDistPath, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(join(clientDistPath, 'index.html'), (error) => {
      if (error && !res.headersSent) next(error);
    });
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

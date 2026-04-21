import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { logger } from './utils/logger';
import { auditMiddleware } from './middleware/auditMiddleware';
import { errorHandler } from './middleware/errorHandler';
import { getAllowedOrigins, getFrontendDistDir, getUploadDir, loadRuntimeEnv, runtime } from './config/runtime';
import authRoutes from './routes/auth.routes';
import customerRoutes from './routes/customer.routes';
import orderRoutes from './routes/order.routes';
import sampleRoutes from './routes/sample.routes';
import shippingRoutes from './routes/shipping.routes';
import rmaRoutes from './routes/rma.routes';
import teamRoutes from './routes/team.routes';
import dashboardRoutes from './routes/dashboard.routes';
import assetRoutes from './routes/asset.routes';
import auditRoutes from './routes/audit.routes';
import procurementRoutes from './routes/procurement.routes';
import collectionRoutes from './routes/collection.routes';
import systemRoutes from './routes/system.routes';
import timberRoutes from './routes/timber.routes';
import contractRoutes from './routes/contract.routes';
import adjustmentRoutes from './routes/adjustment.routes';
import productionRoutes from './routes/production.routes';
import financeRoutes from './routes/finance.routes';
import barterRoutes from './routes/barter.routes';
import currencyRoutes from './routes/currency.routes';
import warehouseRoutes from './routes/warehouse.routes';
import receiptDiscrepancyRoutes from './routes/receipt-discrepancy.routes';
import roleRoutes from './routes/role.routes';
import { BackupService } from './services/backup.service';

loadRuntimeEnv();

const app: Application = express();
const PORT = runtime.port;
const allowedOrigins = getAllowedOrigins();
const cspConnectSources = Array.from(new Set([
  "'self'",
  ...allowedOrigins,
  'ws:',
  'wss:',
]));

app.set('trust proxy', runtime.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: cspConnectSources,
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadDir = getUploadDir();
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir, {
  fallthrough: false,
  maxAge: runtime.nodeEnv === 'production' ? '1d' : 0,
}));

const rateLimitWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const rateLimitMax = Number(process.env.API_RATE_LIMIT_MAX || (runtime.nodeEnv === 'production' ? 2000 : 5000));
const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: '请求过于频繁，请稍后再试',
});
app.use('/api/', limiter);

// Audit middleware must stay before API routes so write operations are recorded.
app.use('/api', auditMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

app.get(['/health', '/api/health'], (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    mode: runtime.nodeEnv,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/samples', sampleRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/rma', rmaRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/adjustments', adjustmentRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/barter', barterRoutes);
app.use('/api/timber', timberRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/receipt-discrepancies', receiptDiscrepancyRoutes);
app.use('/api/roles', roleRoutes);

const clientPath = getFrontendDistDir();
const indexPath = path.join(clientPath, 'index.html');

if (runtime.serveFrontend && fs.existsSync(indexPath)) {
  app.use(express.static(clientPath));

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    return res.sendFile(indexPath);
  });
}

app.use((req: Request, res: Response) => {
  if (runtime.serveFrontend && !req.path.startsWith('/api') && fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  return res.status(404).json({
    success: false,
    message: '接口不存在',
  });
});

app.use(errorHandler);

const startServer = async () => {
  try {
    BackupService.init();
    setInterval(() => {
      logger.info('Starting daily backup...');
      BackupService.performBackup().catch(err => logger.error('Automatic backup failed:', err));
    }, 24 * 60 * 60 * 1000);

    app.listen(PORT, () => {
      logger.info(`Server started successfully. Port: ${PORT}`);
      logger.info(`Environment: ${runtime.nodeEnv}`);
      logger.info(`CORS: ${allowedOrigins.join(',')}`);
      logger.info(`SQLite: ${runtime.sqliteDbPath || 'not configured'}`);
    });
  } catch (error) {
    logger.error('Server startup failed', error);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信号，准备关闭服务器...');
  process.exit(0);
});

export default app;

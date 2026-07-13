import './observability/instrumentation';
import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Server } from 'http';
import path from 'path';
import fs from 'fs';
import { logger } from './utils/logger';
import { auditMiddleware } from './middleware/auditMiddleware';
import { errorHandler } from './middleware/errorHandler';
import { getAllowedOrigins, getBackupDir, getFrontendDistDir, getUploadDir, loadRuntimeEnv, runtime } from './config/runtime';
import prisma, { configureRuntimeDatabase } from './config/database';
import { buildOpenApiDocument, renderOpenApiDocsHtml } from './openapi/openapiDocument';
import { mountApiRoutes } from './routes/apiRegistry';
import { BackupService } from './services/backup.service';
import { fileStorage, getFileStorageStatus } from './services/file-storage.service';
import { cacheService } from './services/cache.service';
import { getSearchStatus } from './services/search.service';
import { createCsrfBoundary } from './security/csrfBoundary';
import { getJwtSecretStatus } from './security/secretManagement';
import { hasValidMetricsBearerToken } from './security/metricsAccess';
import { metricsMiddleware, recordRumVital, renderPrometheusMetrics } from './middleware/metricsMiddleware';
import { authenticate, authorize, authorizePermission, type AuthRequest } from './middleware/auth';
import { attachRealtimeNotifications, getRealtimeNotificationStatus } from './services/realtime-notification.service';
import { getTraceContext, traceContextMiddleware } from './middleware/traceContext';
import { createApiRateLimitStore, getRateLimitStoreStatus } from './services/distributed-rate-limit.service';
import { getAuthTokenStoreStatus } from './services/auth-token-store.service';
import { probeRedis } from './infrastructure/redis-runtime';
import { getTelemetryStatus, shutdownTelemetry } from './observability/instrumentation';

loadRuntimeEnv();

const app: Application = express();
const PORT = runtime.port;
const allowedOrigins = getAllowedOrigins();
const shutdownSignalPath = runtime.sqliteDbPath ? path.join(path.dirname(runtime.sqliteDbPath), 'shutdown.signal') : null;
let server: Server | null = null;
let dailyBackupTimer: NodeJS.Timeout | null = null;
let shutdownSignalTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
const cspConnectSources = Array.from(new Set([
  "'self'",
  ...allowedOrigins,
  'ws:',
  'wss:',
]));
const allowUnsafeInlineCsp = String(process.env.AILAODA_ALLOW_UNSAFE_INLINE_CSP || '').toLowerCase() === 'true';
const cspScriptSources = allowUnsafeInlineCsp ? ["'self'", "'unsafe-inline'"] : ["'self'"];
const cspStyleSources = allowUnsafeInlineCsp ? ["'self'", "'unsafe-inline'"] : ["'self'"];
const cspStyleAttributeSources = ["'unsafe-inline'"];

app.set('trust proxy', runtime.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: cspScriptSources,
      styleSrc: cspStyleSources,
      styleSrcElem: cspStyleSources,
      styleSrcAttr: cspStyleAttributeSources,
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
app.use(createCsrfBoundary({ allowedOrigins }));
app.use(traceContextMiddleware);
app.use(metricsMiddleware);

const uploadDir = getUploadDir();
fs.mkdirSync(uploadDir, { recursive: true });

const sendUploadFile = async (subdir: string, filename: string, res: Response) => {
  if (subdir !== 'contracts' && subdir !== 'pod') {
    return res.status(400).json({ success: false, message: 'Invalid file path.' });
  }
  const target = await fileStorage.resolveDownload(subdir, filename);
  if (!target) {
    return res.status(404).json({ success: false, message: 'File not found.' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(target.fileName)}"`);
  return res.sendFile(target.localPath);
};

app.get('/uploads/contracts/:filename', authenticate, authorizePermission('contracts.read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendUploadFile('contracts', req.params.filename, res);
  } catch (error) {
    next(error);
  }
});

app.get('/uploads/pod/:filename', authenticate, authorizePermission('shipping.receipts.read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendUploadFile('pod', req.params.filename, res);
  } catch (error) {
    next(error);
  }
});

const rateLimitWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const rateLimitMax = Number(process.env.API_RATE_LIMIT_MAX || (runtime.nodeEnv === 'production' ? 2000 : 5000));
const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: createApiRateLimitStore(),
  message: '请求过于频繁，请稍后再试',
});
app.use('/api/', limiter);

app.get(['/api/system/health-details', '/api/v1/system/health-details'], authenticate, authorize('admin'), async (_req: Request, res: Response) => {
  const minimumFreeDiskBytes = Number(process.env.MIN_FREE_DISK_BYTES || 512 * 1024 * 1024);
  const backupDir = getBackupDir();
  let freeDiskBytes: number | null = null;

  try {
    const diskStats = await fs.promises.statfs(backupDir);
    freeDiskBytes = Number(diskStats.bavail) * Number(diskStats.bsize);
  } catch (error) {
    logger.error('Health detail disk probe failed', error);
  }

  res.json({
    status: freeDiskBytes === null || freeDiskBytes < minimumFreeDiskBytes ? 'degraded' : 'ok',
    freeDiskBytes,
    minimumFreeDiskBytes,
    redis: await probeRedis(),
    cache: cacheService.status(),
    authTokens: getAuthTokenStoreStatus(),
    rateLimits: getRateLimitStoreStatus(),
    search: getSearchStatus(),
    objectStorage: getFileStorageStatus(),
    realtime: getRealtimeNotificationStatus(),
    telemetry: getTelemetryStatus(),
    secrets: {
      jwt: getJwtSecretStatus(),
    },
    timestamp: new Date().toISOString(),
  });
});

// Audit middleware must stay before API routes so write operations are recorded.
app.use('/api', auditMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  const traceContext = getTraceContext(req);
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    traceId: traceContext?.traceId,
    spanId: traceContext?.spanId,
    requestId: traceContext?.requestId,
  });
  next();
});

app.get(['/livez', '/api/livez', '/api/v1/livez'], (_req: Request, res: Response) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get(['/ready', '/api/ready', '/api/v1/ready'], async (_req: Request, res: Response) => {
  const dependencyPolicy = {
    critical: ['database', 'redis'],
    degradable: ['search', 'objectStorage', 'telemetry'],
  };
  const degradable = {
    search: getSearchStatus(),
    objectStorage: getFileStorageStatus(),
    telemetry: getTelemetryStatus(),
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redis = await probeRedis();
    if (!redis.ready) {
      return res.status(503).json({ status: 'not-ready', database: 'ok', redis, dependencyPolicy, degradable, timestamp: new Date().toISOString() });
    }
    return res.json({ status: 'ready', database: 'ok', redis, dependencyPolicy, degradable, timestamp: new Date().toISOString(), uptime: process.uptime() });
  } catch (error) {
    logger.error('Readiness database probe failed', error);
    return res.status(503).json({ status: 'not-ready', database: 'unavailable', dependencyPolicy, degradable, timestamp: new Date().toISOString() });
  }
});

app.get(['/health', '/api/health', '/api/v1/health'], async (_req: Request, res: Response) => {
  const checks = {
    database: 'ok',
    backupDir: 'ok',
    disk: 'ok',
  };
  const minimumFreeDiskBytes = Number(process.env.MIN_FREE_DISK_BYTES || 512 * 1024 * 1024);
  let freeDiskBytes: number | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    checks.database = 'unavailable';
    logger.error('Health check database probe failed', error);
  }

  const backupDir = getBackupDir();
  try {
    await fs.promises.access(backupDir, fs.constants.W_OK);
  } catch (error) {
    checks.backupDir = 'unavailable';
    logger.error('Health check backup directory probe failed', error);
  }

  try {
    const diskStats = await fs.promises.statfs(backupDir);
    freeDiskBytes = Number(diskStats.bavail) * Number(diskStats.bsize);
    if (freeDiskBytes < minimumFreeDiskBytes) checks.disk = 'low';
  } catch (error) {
    checks.disk = 'unavailable';
    logger.error('Health check disk probe failed', error);
  }

  const redis = await probeRedis();
  const healthy = Object.values(checks).every((value) => value === 'ok') && redis.ready;
  const cache = cacheService.status();
  const jwtSecret = getJwtSecretStatus();
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    mode: runtime.nodeEnv,
    database: checks.database === 'ok' ? 'ok' : 'unavailable',
    redis,
    cache,
    authTokens: getAuthTokenStoreStatus(),
    rateLimits: getRateLimitStoreStatus(),
    search: getSearchStatus(),
    objectStorage: getFileStorageStatus(),
    realtime: getRealtimeNotificationStatus(),
    telemetry: getTelemetryStatus(),
    secrets: {
      jwt: {
        configured: jwtSecret.configured,
        source: jwtSecret.source,
        issues: jwtSecret.issues,
      },
    },
    checks: {
      database: checks.database,
      backupDir: checks.backupDir,
      disk: checks.disk,
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

const authorizeMetricsAccess = (req: Request, res: Response, next: NextFunction) => {
  if (hasValidMetricsBearerToken(req.headers.authorization)) return next();
  return authenticate(req as AuthRequest, res, () => authorizePermission('system.metrics.read')(req as AuthRequest, res, next));
};

app.get('/metrics', authorizeMetricsAccess, (_req: Request, res: Response) => {
  res.type('text/plain; version=0.0.4');
  res.send(renderPrometheusMetrics());
});

app.post(['/api/rum/vitals', '/api/v1/rum/vitals'], (req: Request, res: Response) => {
  const body = req.body as { vitals?: unknown };
  if (!Array.isArray(body.vitals) || body.vitals.length === 0 || body.vitals.length > 20) {
    return res.status(400).json({ success: false, message: 'Invalid Web Vitals payload.' });
  }

  let accepted = 0;
  for (const item of body.vitals) {
    if (!item || typeof item !== 'object') continue;
    const vital = item as { name?: unknown; value?: unknown; rating?: unknown; path?: unknown };
    const wasAccepted = recordRumVital({
      name: typeof vital.name === 'string' ? vital.name : '',
      value: typeof vital.value === 'number' ? vital.value : Number.NaN,
      rating: typeof vital.rating === 'string' ? vital.rating : 'unknown',
      path: typeof vital.path === 'string' ? vital.path : '/',
    });
    if (wasAccepted) accepted += 1;
  }

  if (accepted === 0) {
    return res.status(400).json({ success: false, message: 'No valid Web Vitals samples were accepted.' });
  }

  return res.status(202).json({ success: true, accepted });
});

app.get(['/api/openapi.json', '/api/v1/openapi.json'], (_req: Request, res: Response) => {
  res.json(buildOpenApiDocument());
});

app.get('/api/docs', (_req: Request, res: Response) => {
  res.type('html').send(renderOpenApiDocsHtml('/api/openapi.json'));
});

app.get('/api/v1/docs', (_req: Request, res: Response) => {
  res.type('html').send(renderOpenApiDocsHtml('/api/v1/openapi.json'));
});

mountApiRoutes(app);

const clientPath = getFrontendDistDir();
const indexPath = path.join(clientPath, 'index.html');
const serviceWorkerPath = path.join(clientPath, 'sw.js');

if (runtime.serveFrontend && fs.existsSync(indexPath)) {
  app.get('/sw.js', (_req: Request, res: Response) => {
    if (!fs.existsSync(serviceWorkerPath)) {
      return res.status(404).type('text/plain').send('service worker is not built');
    }
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(serviceWorkerPath);
  });

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

const removeShutdownSignal = () => {
  if (!shutdownSignalPath || !fs.existsSync(shutdownSignalPath)) return;
  fs.unlinkSync(shutdownSignalPath);
};

const shutdownGracefully = (reason: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`开始优雅关闭服务器: ${reason}`);

  if (dailyBackupTimer) clearInterval(dailyBackupTimer);
  if (shutdownSignalTimer) clearInterval(shutdownSignalTimer);

  const forceExitTimer = setTimeout(() => {
    logger.error('优雅关闭超过 10 秒，强制退出。');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  const closeDatabaseAndExit = async (code: number) => {
    try {
      await shutdownTelemetry();
      logger.info('OpenTelemetry exporter closed');
    } catch (error) {
      logger.error('OpenTelemetry shutdown failed', error);
    }
    try {
      await prisma.$disconnect();
      logger.info('数据库连接已关闭');
    } catch (error) {
      logger.error('数据库关闭失败', error);
    }
    clearTimeout(forceExitTimer);
    process.exit(code);
  };

  if (server) {
    server.close((error) => {
      if (error) {
        logger.error('HTTP 服务关闭失败', error);
        closeDatabaseAndExit(1).catch(() => process.exit(1));
        return;
      }
      closeDatabaseAndExit(0).catch(() => process.exit(1));
    });
    (server as Server & { closeIdleConnections?: () => void }).closeIdleConnections?.();
    setTimeout(() => {
      (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    }, 2000).unref();
    return;
  }

  closeDatabaseAndExit(0).catch(() => process.exit(1));
};

const startShutdownSignalWatcher = () => {
  if (!shutdownSignalPath) return;
  removeShutdownSignal();
  shutdownSignalTimer = setInterval(() => {
    try {
      if (!fs.existsSync(shutdownSignalPath)) return;
      removeShutdownSignal();
      shutdownGracefully('local shutdown signal');
    } catch (error) {
      logger.error('本地关闭信号处理失败', error);
    }
  }, 1000);
  shutdownSignalTimer.unref();
};

const startServer = async () => {
  try {
    await configureRuntimeDatabase();
    BackupService.init();
    dailyBackupTimer = setInterval(() => {
      logger.info('Starting daily backup...');
      BackupService.performBackup().catch(err => logger.error('Automatic backup failed:', err));
    }, 24 * 60 * 60 * 1000);
    dailyBackupTimer.unref();
    startShutdownSignalWatcher();

    server = app.listen(PORT, () => {
      if (server) attachRealtimeNotifications(server);
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
  shutdownGracefully('SIGTERM');
});

process.on('SIGINT', () => {
  shutdownGracefully('SIGINT');
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('未处理的 Promise rejection，系统继续运行', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('未捕获的同步异常，即将优雅退出', {
    message: error.message,
    stack: error.stack,
  });
  shutdownGracefully('uncaughtException');
});

export default app;

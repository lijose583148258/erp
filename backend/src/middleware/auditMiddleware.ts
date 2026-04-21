import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import prisma from '../config/database';
import { logger } from '../utils/logger';

export const auditMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';

    // Intercept response to log execution time and status
    res.on('finish', async () => {
        const duration = Date.now() - start;
        const { statusCode } = res;
        const userId = req.user?.userId;

        // Only log authenticated requests or interesting failures
        if (userId || statusCode >= 400) {
            try {
                // We log to console/file via winston
                logger.info(`${method} ${originalUrl} ${statusCode} ${duration}ms - User:${userId || 'anon'}`);

                // Optionally persist to DB for critical actions or all actions if required
                // For high volume, usually we don't log GETs to DB, but for this system we might want track access
                // Let's log non-GET methods to DB Automatically
                if (method !== 'GET' && userId) {
                    await prisma.auditLog.create({
                        data: {
                            userId,
                            action: method,
                            resource: originalUrl.split('?')[0],
                            ipAddress: ip || '',
                            userAgent,
                            details: `Status: ${statusCode}, Duration: ${duration}ms`,
                        }
                    });
                }
            } catch (err) {
                logger.error('Audit log error', err);
            }
        }
    });

    next();
};

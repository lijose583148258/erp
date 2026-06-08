import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import prisma from '../config/database';
import { logger } from '../utils/logger';

const SENSITIVE_QUERY_KEYS = new Set(['token', 'access_token', 'refresh_token', 'refreshtoken', 'password']);

const sanitizeUrl = (url: string) => {
    try {
        const parsed = new URL(url, 'http://ailaoda.local');
        for (const key of Array.from(parsed.searchParams.keys())) {
            if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
                parsed.searchParams.set(key, '[redacted]');
            }
        }
        return `${parsed.pathname}${parsed.search}`;
    } catch {
        return url.replace(/([?&](?:token|access_token|refresh_token|refreshToken|password)=)[^&\s]+/gi, '$1[redacted]');
    }
};

export const auditMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const safeOriginalUrl = sanitizeUrl(originalUrl);
    const userAgent = req.get('user-agent') || '';

    // Intercept response to log execution time and status
    res.on('finish', () => {
        const logPromise = async () => {
            const duration = Date.now() - start;
            const { statusCode } = res;
            const userId = req.user?.userId;

            // Only log authenticated requests or interesting failures
            if (userId || statusCode >= 400) {
                // We log to console/file via winston
                logger.info(`${method} ${safeOriginalUrl} ${statusCode} ${duration}ms - User:${userId || 'anon'}`);

                // Optionally persist to DB for critical actions or all actions if required
                // For high volume, usually we don't log GETs to DB, but for this system we might want track access
                // Let's log non-GET methods to DB Automatically
                if (method !== 'GET' && userId) {
                    await prisma.auditLog.create({
                        data: {
                            userId,
                            action: method,
                            resource: safeOriginalUrl.split('?')[0],
                            ipAddress: ip || '',
                            userAgent,
                            details: `Status: ${statusCode}, Duration: ${duration}ms`,
                        }
                    });
                }
            }
        };

        logPromise().catch((err) => {
            logger.error('Audit log error', err);
        });
    });

    next();
};

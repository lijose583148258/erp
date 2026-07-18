import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { logger } from '../utils/logger';

/**
 * Validate request payload with express-validator
 */
export const validateRequest = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(err => ({
            field: (err as any).path || (err as any).param,
            message: err.msg,
        }));

        logger.warn('Request validation failed', {
            method: req.method,
            path: req.path,
            fields: Array.from(new Set(errorMessages.map(error => error.field).filter(Boolean))),
            errorCount: errorMessages.length,
        });

        return res.status(400).json({
            success: false,
            message: '请求参数验证失败',
            errors: errorMessages,
        });
    }

    next();
};

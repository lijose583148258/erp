import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger';

/**
 * Zod 验证中间件
 * @param schema Zod 校验对象
 * @param source 校验来源 ('body', 'query', 'params')
 */
export const validateZod = (schema: ZodSchema<any>, source: 'body' | 'query' | 'params' = 'body') =>
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsed = await schema.parseAsync(req[source]);
            (req as any)[source] = parsed;
            next();
        } catch (error: any) {
            if (error instanceof ZodError || (error.name === 'ZodError')) {
                const zodIssues = Array.isArray(error.issues) ? error.issues : [];
                const errorMessages: Array<{ field: string; message: string }> = zodIssues.map((err: any) => ({
                    field: err.path ? err.path.join('.') : 'unknown',
                    message: err.message
                }));

                logger.warn('Zod 验证失败', {
                    method: req.method,
                    path: req.path,
                    source,
                    fields: Array.from(new Set(errorMessages.map(errorMessage => errorMessage.field))),
                    errorCount: errorMessages.length
                });

                return res.status(400).json({
                    success: false,
                    message: `输入数据(${source})格式错误`,
                    errors: errorMessages
                });
            }
            next(error);
        }
    };

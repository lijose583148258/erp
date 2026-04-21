import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { query } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest';
import { AuditController } from '../controllers/audit.controller';

const router = Router();
const controller = new AuditController();

router.use(authenticate);
router.use(authorizePermission('audit.read'));

/**
 * @route GET /api/audit
 * @desc 获取审计日志列表
 */
router.get(
    '/',
    [
        query('page').optional().isInt({ min: 1 }),
        query('pageSize').optional().isInt({ min: 1, max: 100 }),
        query('userId').optional().isInt(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
    ],
    validateRequest,
    controller.getLogs
);

export default router;

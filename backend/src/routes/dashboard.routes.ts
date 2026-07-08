import { Router } from 'express';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { getDashboardOverview, getDashboardTrends } from '../services/dashboard-read.service';
import { logger } from '../utils/logger';

const router = Router();

router.use(authenticate, authorizePermission('dashboard.read'));

/**
 * @route GET /api/dashboard
 * @desc 获取仪表盘统计数据
 */
router.get('/', authRoute(async (req, res) => {
    try {
        const data = await getDashboardOverview({
            role: req.user?.role,
            userId: req.user?.userId,
        });

        res.json({
            success: true,
            data,
        });
    } catch (error) {
        logger.error('获取仪表盘数据错误:', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
}));

/**
 * @route GET /api/dashboard/trends
 * @desc 获取趋势数据（最近30天）
 */
router.get('/trends', authRoute(async (req, res) => {
    try {
        const data = await getDashboardTrends({
            role: req.user?.role,
            userId: req.user?.userId,
        });

        res.json({
            success: true,
            data,
        });
    } catch (error) {
        logger.error('获取趋势数据错误:', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
}));

export default router;

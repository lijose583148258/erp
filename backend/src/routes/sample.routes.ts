import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { body, param } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest';
import { SampleController } from '../controllers/sample.controller';

const router = Router();
const controller = new SampleController();

router.use(authenticate);

/**
 * @route GET /api/samples
 * @desc 获取样品列表
 */
router.get('/', authorizePermission('samples.read'), controller.getSamples);

/**
 * @route POST /api/samples
 * @desc 创建样品申请
 */
router.post(
    '/',
    authorizePermission('samples.create'),
    [
        body('customerId').isInt({ min: 1 }),
        body('productName').notEmpty(),
        body('quantity').isFloat({ min: 0.001 }),
    ],
    validateRequest,
    controller.createSample
);

/**
 * @route PATCH /api/samples/:id/status
 * @desc 更新样品状态
 */
router.patch(
    '/:id/status',
    authorizePermission('samples.status.manage'),
    [
        param('id').isInt({ min: 1 }),
        body('status').isIn(['requested', 'sent', 'testing', 'feedback', 'rejected'])
    ],
    validateRequest,
    controller.updateStatus
);

export default router;

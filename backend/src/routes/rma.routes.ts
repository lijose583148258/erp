import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { createRmaSchema, resolveRmaSchema, idParamSchema } from '../validators';
import { RmaController } from '../controllers/rma.controller';

const router = Router();
const controller = new RmaController();

router.use(authenticate);

/**
 * @route GET /api/rma
 * @desc 获取售后列表
 */
router.get('/', authorizePermission('rma.read'), controller.getRmas);

/**
 * @route POST /api/rma
 * @desc 创建售后申请
 */
router.post(
    '/',
    authorizePermission('rma.write'),
    validateZod(createRmaSchema),
    controller.createRma
);

/**
 * @route PATCH /api/rma/:id/resolve
 * @desc 处理售后申请
 */
router.patch(
    '/:id/resolve',
    authorizePermission('rma.resolve'),
    validateZod(idParamSchema, 'params'),
    validateZod(resolveRmaSchema),
    controller.resolveRma
);

export default router;

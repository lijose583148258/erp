import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { param } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest';
import { validateZod } from '../middleware/validateZod';
import { ContractController } from '../controllers/contract.controller';
import { appendContractItemsSchema, createContractSchema, updateContractSchema } from '../validators';

const router = Router();
const controller = new ContractController();

router.use(authenticate);

/**
 * @route GET /api/contracts
 * @desc 获取合同列表
 */
router.get('/', authorizePermission('contracts.read'), controller.getContracts);

/**
 * @route GET /api/contracts/:id
 * @desc 获取合同详情
 */
router.get('/:id', authorizePermission('contracts.read'), [param('id').isInt()], validateRequest, controller.getContractById);

/**
 * @route POST /api/contracts
 * @desc 创建合同
 */
router.post(
    '/',
    authorizePermission('contracts.write'),
    validateZod(createContractSchema),
    controller.createContract
);

/**
 * @route PATCH /api/contracts/:id
 * @desc 更新合同
 */
router.patch(
    '/:id',
    authorizePermission('contracts.write'),
    [param('id').isInt()],
    validateRequest,
    validateZod(updateContractSchema),
    controller.updateContract
);

/**
 * @route POST /api/contracts/:id/items/append
 * @desc 追加合同明细/项 (大闭环集成)
 */
router.post(
    '/:id/items/append',
    authorizePermission('contracts.write'),
    [param('id').isInt()],
    validateRequest,
    validateZod(appendContractItemsSchema),
    controller.appendItems
);

/**
 * @route POST /api/contracts/analyze
 * @desc AI 识别合同
 */
router.post('/analyze', authorizePermission('contracts.write'), controller.analyzeContract);

export default router;

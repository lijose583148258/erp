import { Router } from 'express';
import { CustomerController } from '../controllers/customer.controller';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { createCustomerSchema, querySchema, idParamSchema, updateCustomerPoolSchema, updateCustomerSchema } from '../validators';

const router = Router();
const customerController = new CustomerController();

// 所有客户路由都需要认证
router.use(authenticate);

/**
 * @route GET /api/customers
 * @desc 获取客户列表 (支持分页、搜索、筛选)
 * @access Private
 */
router.get('/', authorizePermission('customers.read'), validateZod(querySchema, 'query'), customerController.getCustomers);

/**
 * @route GET /api/customers/stats
 * @desc 获取客户统计信息
 * @access Private
 */
router.get('/stats', authorizePermission('customers.read'), customerController.getCustomerStats);

router.get('/export', authorizePermission('customers.export'), customerController.exportCustomers);

/**
 * @route GET /api/customers/:id
 * @desc 获取单个客户详情
 * @access Private
 */
router.get('/:id', authorizePermission('customers.read'), validateZod(idParamSchema, 'params'), customerController.getCustomerById);

/**
 * @route PATCH /api/customers/:id/pool
 * @desc 更新客户池状态
 * @access Private (管理员/经理)
 */
router.patch(
    '/:id/pool',
    authorizePermission('customers.pool.manage'),
    validateZod(idParamSchema, 'params'),
    validateZod(updateCustomerPoolSchema),
    customerController.updateCustomerPool
);

/**
 * @route POST /api/customers
 * @desc 创建新客户
 * @access Private (销售及以上)
 */
router.post(
    '/',
    authorizePermission('customers.create'),
    validateZod(createCustomerSchema),
    customerController.createCustomer
);

/**
 * @route PUT /api/customers/:id
 * @desc 更新客户信息
 * @access Private (销售及以上)
 */
router.put(
    '/:id',
    authorizePermission('customers.update'),
    validateZod(idParamSchema, 'params'),
    validateZod(updateCustomerSchema),
    customerController.updateCustomer
);

/**
 * @route DELETE /api/customers/:id
 * @desc 删除客户 (软删除)
 * @access Private (管理员)
 */
router.delete(
    '/:id',
    authorizePermission('customers.delete'),
    validateZod(idParamSchema, 'params'),
    customerController.deleteCustomer
);

/**
 * @route GET /api/customers/:id/orders
 * @desc 获取客户的所有订单
 * @access Private
 */
router.get('/:id/orders', authorizePermission('customers.read'), validateZod(idParamSchema, 'params'), customerController.getCustomerOrders);

/**
 * @route GET /api/customers/:id/rma
 * @desc 获取客户的所有售后记录
 * @access Private
 */
router.get('/:id/rma', authorizePermission('customers.read'), validateZod(idParamSchema, 'params'), customerController.getCustomerRmas);

/**
 * @route GET /api/customers/:id/assets
 * @desc 获取客户的所有资产流转记录
 * @access Private
 */
router.get('/:id/assets', authorizePermission('customers.read'), validateZod(idParamSchema, 'params'), customerController.getCustomerAssets);

/**
 * @route GET /api/customers/:id/pool-history
 * @desc 获取客户池变更历史
 * @access Private
 */
router.get('/:id/pool-history', authorizePermission('customers.read'), validateZod(idParamSchema, 'params'), customerController.getCustomerPoolHistory);

/**
 * @route POST /api/customers/import
 * @desc 批量导入客户 (支持500条)
 * @access Private (管理员)
 */
router.post(
    '/import',
    authorizePermission('customers.import'),
    customerController.importCustomers
);

/**
 * @route GET /api/customers/export
 * @desc 导出客户列表 (支持1000条)
 * @access Private
 */
export default router;

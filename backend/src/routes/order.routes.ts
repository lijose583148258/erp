import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { createOrderSchema, importOrdersSchema, orderPaymentVerifyParamsSchema, orderQuerySchema, idParamSchema, paymentSchema, statusUpdateSchema, updateOrderSchema } from '../validators';

const router = Router();
const orderController = new OrderController();

// 所有订单路由都需要认证
router.use(authenticate);

/**
 * @route GET /api/orders
 * @desc 获取订单列表 (支持分页、搜索、筛选)
 * @access Private
 */
router.get('/', authorizePermission('orders.read'), validateZod(orderQuerySchema, 'query'), orderController.getOrders);

/**
 * @route GET /api/orders/stats
 * @desc 获取订单统计信息
 * @access Private
 */
router.get('/stats', authorizePermission('orders.read'), orderController.getOrderStats);

router.get('/shipping-ready', authorizePermission('orders.shippingReady.read'), orderController.getAvailableForShipping);

router.get('/export', authorizePermission('orders.export'), orderController.exportOrders);

/**
 * @route GET /api/orders/:id
 * @desc 获取订单详情
 * @access Private
 */
router.get('/:id', authorizePermission('orders.read'), validateZod(idParamSchema, 'params'), orderController.getOrderById);

/**
 * @route POST /api/orders
 * @desc 创建订单
 * @access Private (销售及以上)
 */
router.post(
    '/',
    authorizePermission('orders.create'),
    validateZod(createOrderSchema),
    orderController.createOrder
);

/**
 * @route PUT /api/orders/:id
 * @desc 更新订单
 * @access Private (销售及以上)
 */
router.put(
    '/:id',
    authorizePermission('orders.update'),
    validateZod(idParamSchema, 'params'),
    validateZod(updateOrderSchema),
    orderController.updateOrder
);

/**
 * @route PATCH /api/orders/:id/status
 * @desc 更新订单状态
 * @access Private
 */
router.patch(
    '/:id/status',
    authorizePermission('orders.status.manage'),
    validateZod(idParamSchema, 'params'),
    validateZod(statusUpdateSchema),
    orderController.updateOrderStatus
);

/**
 * @route POST /api/orders/:id/payment
 * @desc 记录付款
 * @access Private
 */
router.post(
    '/:id/payment',
    authorizePermission('orders.payment.record'),
    validateZod(idParamSchema, 'params'),
    validateZod(paymentSchema),
    orderController.recordPayment
);


/**
 * @route POST /api/orders/:id/payment/:paymentId/verify
 * @desc 审核付款记录
 * @access Private (财务/管理员)
 */
router.post(
    '/:id/payment/:paymentId/verify',
    authorizePermission('orders.payment.verify'),
    validateZod(orderPaymentVerifyParamsSchema, 'params'),
    orderController.verifyPayment
);

/**
 * @route POST /api/orders/import
 * @desc 批量导入订单 (支持500条)
 * @access Private (管理员)
 */
router.post(
    '/import',
    authorizePermission('orders.import'),
    validateZod(importOrdersSchema),
    orderController.importOrders
);

/**
 * @route PUT /api/orders/:id/complete
 * @desc 手动结案
 * @access Private (管理员/经理)
 */
router.put(
    '/:id/complete',
    authorizePermission('orders.complete'),
    validateZod(idParamSchema, 'params'),
    orderController.completeOrder
);

export default router;

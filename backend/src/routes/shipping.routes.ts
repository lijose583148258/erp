import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { createShipmentSchema, updateShipmentStatusSchema, uploadShipmentReceiptSchema, createShipmentReceiptEventSchema, idParamSchema } from '../validators';
import { ShippingController } from '../controllers/shipping.controller';

const router = Router();
const controller = new ShippingController();

router.use(authenticate);

/**
 * @route GET /api/shipping
 * @desc 获取物流列表
 */
router.get('/', authorizePermission('shipping.read'), controller.getShipments);

/**
 * @route POST /api/shipping
 * @desc 创建发货单
 */
router.post(
    '/',
    authorizePermission('shipping.write'),
    validateZod(createShipmentSchema),
    controller.createShipment
);

/**
 * @route PATCH /api/shipping/:id/status
 * @desc 更新物流状态
 */
router.patch(
    '/:id/status',
    authorizePermission('shipping.write'),
    validateZod(idParamSchema, 'params'),
    validateZod(updateShipmentStatusSchema),
    controller.updateStatus
);

router.post(
    '/:id/receipt',
    authorizePermission('shipping.write'),
    validateZod(idParamSchema, 'params'),
    validateZod(uploadShipmentReceiptSchema),
    controller.uploadReceipt
);

router.get(
    '/:id/receipts',
    authorizePermission('shipping.receipts.read'),
    validateZod(idParamSchema, 'params'),
    controller.getReceiptEvents
);

router.post(
    '/:id/receipt-events',
    authorizePermission('shipping.write'),
    validateZod(idParamSchema, 'params'),
    validateZod(createShipmentReceiptEventSchema),
    controller.createReceiptEvent
);

export default router;

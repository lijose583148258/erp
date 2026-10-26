import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { createShipmentSchema, updateShipmentStatusSchema, uploadShipmentReceiptSchema, createShipmentReceiptEventSchema, idParamSchema } from '../validators';
import { ShippingController } from '../controllers/shipping.controller';
import { reserveShipmentSchema, releaseShipmentSchema } from '../services/shipment-stock-reservation.service';
import { shipmentSupplementSchema } from '../services/shipment-supplement.service';

const router = Router();
const controller = new ShippingController();

router.use(authenticate);

/**
 * @route GET /api/shipping
 * @desc 获取物流列表
 */
router.get('/', authorizePermission('shipping.read'), controller.getShipments);
router.get('/submissions/:key', authorizePermission('shipping.write'), controller.getSubmission);
router.get('/:id/supplement', authorizePermission('shipping.read'), validateZod(idParamSchema, 'params'), controller.readSupplement);
router.patch('/:id/supplement', authorizePermission('shipping.write'), validateZod(idParamSchema, 'params'), validateZod(shipmentSupplementSchema), controller.supplement);
router.get('/:id/reservation', authorizePermission('shipping.read'), validateZod(idParamSchema, 'params'), controller.readReservation);
router.post('/:id/reserve', authorizePermission('shipping.write'), validateZod(idParamSchema, 'params'), validateZod(reserveShipmentSchema), controller.reserveStock);
router.post('/:id/release-reservation', authorizePermission('shipping.write'), validateZod(idParamSchema, 'params'), validateZod(releaseShipmentSchema), controller.releaseStock);

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

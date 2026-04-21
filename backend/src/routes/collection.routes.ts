import { Router } from 'express';
import { param } from 'express-validator';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { validateZod } from '../middleware/validateZod';
import { CollectionController } from '../controllers/collection.controller';
import {
    createDisputeSchema,
    batchReminderSchema,
    createPromiseSchema,
    customerHoldReleaseSchema,
    customerHoldSchema,
    orderHoldSchema,
    updateDisputeStatusSchema,
    updatePromiseStatusSchema,
} from '../validators';

const router = Router();
const controller = new CollectionController();

router.use(authenticate);

router.get('/summary', authorizePermission('collections.read'), authRoute((req, res) => controller.getSummary(req, res)));
router.get('/workbench', authorizePermission('collections.read'), authRoute((req, res) => controller.getWorkbench(req, res)));
router.get('/ledger', authorizePermission('collections.read'), authRoute((req, res) => controller.getLedger(req, res)));
router.get('/overdue', authorizePermission('collections.read'), authRoute((req, res) => controller.getOverdueOrders(req, res)));
router.get('/milestones', authorizePermission('collections.read'), authRoute((req, res) => controller.getMilestones(req, res)));
router.get('/promises', authorizePermission('collections.read'), authRoute((req, res) => controller.getPromises(req, res)));
router.get('/disputes', authorizePermission('collections.read'), authRoute((req, res) => controller.getDisputes(req, res)));
router.get('/holds', authorizePermission('collections.read'), authRoute((req, res) => controller.getHolds(req, res)));

router.post(
    '/sync-overdue',
    authorizePermission('collections.sync'),
    authRoute((req, res) => controller.syncOverdue(req, res))
);

router.post(
    '/payments/:paymentId/verify',
    authorizePermission('orders.payment.verify'),
    [param('paymentId').isInt({ min: 1 })],
    validateRequest,
    authRoute((req, res) => controller.verifyPaymentRecord(req, res))
);

router.post(
    '/orders/:orderId/remind',
    authorizePermission('collections.reminder.write'),
    [param('orderId').isInt({ min: 1 })],
    validateRequest,
    authRoute((req, res) => controller.createReminder(req, res))
);

router.post(
    '/orders/remind-batch',
    authorizePermission('collections.reminder.write'),
    validateZod(batchReminderSchema),
    authRoute((req, res) => controller.createBatchReminders(req, res))
);

router.post(
    '/promises',
    authorizePermission('collections.promise.write'),
    validateZod(createPromiseSchema),
    authRoute((req, res) => controller.createPromise(req, res))
);

router.patch(
    '/promises/:promiseId/status',
    authorizePermission('collections.promise.write'),
    [param('promiseId').isInt({ min: 1 })],
    validateRequest,
    validateZod(updatePromiseStatusSchema),
    authRoute((req, res) => controller.updatePromiseStatus(req, res))
);

router.post(
    '/disputes',
    authorizePermission('collections.dispute.write'),
    validateZod(createDisputeSchema),
    authRoute((req, res) => controller.createDispute(req, res))
);

router.patch(
    '/disputes/:disputeId/status',
    authorizePermission('collections.dispute.write'),
    [param('disputeId').isInt({ min: 1 })],
    validateRequest,
    validateZod(updateDisputeStatusSchema),
    authRoute((req, res) => controller.updateDisputeStatus(req, res))
);

router.post(
    '/customers/:customerId/hold',
    authorizePermission('collections.hold.manage'),
    [param('customerId').isInt({ min: 1 })],
    validateRequest,
    validateZod(customerHoldSchema),
    authRoute((req, res) => controller.setCustomerHold(req, res))
);

router.delete(
    '/customers/:customerId/hold',
    authorizePermission('collections.hold.manage'),
    [param('customerId').isInt({ min: 1 })],
    validateRequest,
    validateZod(customerHoldReleaseSchema),
    authRoute((req, res) => controller.releaseCustomerHold(req, res))
);

router.post(
    '/orders/:orderId/shipment-hold',
    authorizePermission('collections.hold.manage'),
    [param('orderId').isInt({ min: 1 })],
    validateRequest,
    validateZod(orderHoldSchema),
    authRoute((req, res) => controller.setOrderShipmentHold(req, res))
);

router.delete(
    '/orders/:orderId/shipment-hold',
    authorizePermission('collections.hold.manage'),
    [param('orderId').isInt({ min: 1 })],
    validateRequest,
    authRoute((req, res) => controller.releaseOrderShipmentHold(req, res))
);

export default router;

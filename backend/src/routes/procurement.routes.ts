import { Router } from 'express';
import { ProcurementController } from '../controllers/procurement.controller';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import {
  createPurchaseOrderSchema,
  createPurchaseReceiptSchema,
  createSupplierSchema,
  idParamSchema,
  purchaseStatusUpdateSchema,
  salesOrderIdParamSchema,
} from '../validators';

const router = Router();
const procurementController = new ProcurementController();

router.use(authenticate);

router.get('/suppliers', authorizePermission('procurement.suppliers.read'), procurementController.getSuppliers);
router.post('/suppliers', authorizePermission('procurement.write'), validateZod(createSupplierSchema), procurementController.createSupplier);

router.get('/orders', authorizePermission('procurement.read'), procurementController.getOrders);
router.post('/orders', authorizePermission('procurement.write'), validateZod(createPurchaseOrderSchema), procurementController.createOrder);
router.patch('/orders/:id/status', authorizePermission('procurement.write'), validateZod(idParamSchema, 'params'), validateZod(purchaseStatusUpdateSchema), procurementController.updateOrderStatus);
router.get('/orders/:id/receipts', authorizePermission('procurement.read'), validateZod(idParamSchema, 'params'), procurementController.getOrderReceipts);
router.post('/orders/:id/receipts', authorizePermission('procurement.write'), validateZod(idParamSchema, 'params'), validateZod(createPurchaseReceiptSchema), procurementController.createReceipt);

router.post('/orders/:id/link-b2b', authorizePermission('procurement.write'), validateZod(idParamSchema, 'params'), procurementController.linkB2BOrder);
router.get('/b2b-status/:salesOrderId', authorizePermission('procurement.b2b.read'), validateZod(salesOrderIdParamSchema, 'params'), procurementController.getB2BStatus);
router.post('/sync-b2b/:salesOrderId', authorizePermission('procurement.write'), validateZod(salesOrderIdParamSchema, 'params'), procurementController.syncB2BStatus);

export default router;



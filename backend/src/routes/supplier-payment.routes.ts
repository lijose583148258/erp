import { Router } from 'express';
import { authorizePermission } from '../middleware/auth';
import { SupplierPaymentController } from '../controllers/supplier-payment.controller';

// Mounted after the procurement parent's authenticate middleware. No second
// auth stack, general payment platform, or reuse of customer-payment authority.
const router = Router(), controller = new SupplierPaymentController();
router.get('/payables', authorizePermission('finance.read'), controller.getPayables);
router.get('/receipts/:id/payments', authorizePermission('finance.read'), controller.getPayments);
router.post('/receipts/:id/payments', authorizePermission('procurement.payment.record'), controller.register);
router.post('/supplier-payments/:id/verify', authorizePermission('procurement.payment.verify'), controller.verify);
router.post('/supplier-payments/:id/cancel', authorizePermission('procurement.payment.record'), controller.cancel);
export default router;

import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { FinanceController } from '../controllers/finance.controller';
import {
  createReceivableAdjustmentSchema,
  reverseReceivableAdjustmentSchema,
} from '../validators';

const router = Router();
const controller = new FinanceController();

router.use(authenticate, authorizePermission('finance.read'));

router.get('/summary', (req, res) => controller.getSummary(req, res));
router.get('/workspace', (req, res) => controller.getWorkspace(req, res));
router.get('/receivable-adjustments', (req, res) => controller.listReceivableAdjustments(req, res));
router.post(
  '/receivable-adjustments',
  authorizePermission('adjustments.write'),
  validateZod(createReceivableAdjustmentSchema),
  (req, res) => controller.createReceivableAdjustment(req, res),
);
router.post(
  '/receivable-adjustments/:id/post',
  authorizePermission('adjustments.apply'),
  (req, res) => controller.postReceivableAdjustment(req, res),
);
router.post(
  '/receivable-adjustments/:id/reverse',
  authorizePermission('adjustments.reverse'),
  validateZod(reverseReceivableAdjustmentSchema),
  (req, res) => controller.reverseReceivableAdjustment(req, res),
);

export default router;

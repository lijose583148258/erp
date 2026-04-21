import { Router } from 'express';
import { param } from 'express-validator';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { validateZod } from '../middleware/validateZod';
import { ReceiptDiscrepancyController } from '../controllers/receipt-discrepancy.controller';
import { createReceiptDiscrepancyActionSchema, createReceiptToleranceRuleSchema, resolveReceiptDiscrepancySchema } from '../validators';

const router = Router();
const controller = new ReceiptDiscrepancyController();

router.use(authenticate);

router.get('/tolerance-rules', authorizePermission('discrepancies.read'), controller.getToleranceRules);
router.post('/tolerance-rules', authorizePermission('discrepancies.rules.manage'), validateZod(createReceiptToleranceRuleSchema), controller.createToleranceRule);
router.get('/', authorizePermission('discrepancies.read'), controller.getCases);
router.get(
  '/:id/actions',
  authorizePermission('discrepancies.read'),
  [param('id').isInt({ min: 1 })],
  validateRequest,
  controller.getCaseActions,
);
router.post(
  '/:id/actions',
  authorizePermission('discrepancies.write'),
  [param('id').isInt({ min: 1 })],
  validateRequest,
  validateZod(createReceiptDiscrepancyActionSchema),
  controller.createCaseAction,
);
router.patch(
  '/:id/resolve',
  authorizePermission('discrepancies.write'),
  [param('id').isInt({ min: 1 })],
  validateRequest,
  validateZod(resolveReceiptDiscrepancySchema),
  controller.resolveCase,
);

export default router;

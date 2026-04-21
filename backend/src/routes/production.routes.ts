import { Router } from 'express';
import { param } from 'express-validator';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { validateRequest } from '../middleware/validateRequest';
import { ProductionController } from '../controllers/production.controller';
import {
  createProductionBomSchema,
  createProductionQualityCheckSchema,
  createProductionWorkOrderSchema,
  updateProductionStepSchema,
  updateProductionWorkOrderStatusSchema,
} from '../validators';

const router = Router();
const controller = new ProductionController();

router.use(authenticate);

router.get('/summary', authorizePermission('production.read'), authRoute((req, res) => controller.getSummary(req, res)));
router.get('/boms', authorizePermission('production.read'), authRoute((req, res) => controller.getBoms(req, res)));
router.post('/boms', authorizePermission('production.write'), validateZod(createProductionBomSchema), authRoute((req, res) => controller.createBom(req, res)));
router.get('/work-orders', authorizePermission('production.read'), authRoute((req, res) => controller.getWorkOrders(req, res)));
router.get('/work-orders/:id/preview-consumption', authorizePermission('production.read'), [param('id').isInt({ min: 1 })], validateRequest, authRoute((req, res) => controller.previewConsumption(req, res)));
router.get(
  '/batches/:batchId/cost-ledger',
  authorizePermission('production.read'),
  [param('batchId').isInt({ min: 1 })],
  validateRequest,
  authRoute((req, res) => controller.getBatchCostLedger(req, res)),
);
router.post('/work-orders', authorizePermission('production.write'), validateZod(createProductionWorkOrderSchema), authRoute((req, res) => controller.createWorkOrder(req, res)));
router.patch(
  '/work-orders/:id/status',
  authorizePermission('production.write'),
  [param('id').isInt({ min: 1 })],
  validateRequest,
  validateZod(updateProductionWorkOrderStatusSchema),
  authRoute((req, res) => controller.updateWorkOrderStatus(req, res)),
);
router.patch(
  '/work-orders/:id/steps/:stepId',
  authorizePermission('production.write'),
  [param('id').isInt({ min: 1 }), param('stepId').isInt({ min: 1 })],
  validateRequest,
  validateZod(updateProductionStepSchema),
  authRoute((req, res) => controller.updateStep(req, res)),
);
router.post(
  '/work-orders/:id/checks',
  authorizePermission('production.write'),
  [param('id').isInt({ min: 1 })],
  validateRequest,
  validateZod(createProductionQualityCheckSchema),
  authRoute((req, res) => controller.createQualityCheck(req, res)),
);

export default router;


import { Router } from 'express';
import { param } from 'express-validator';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { validateRequest } from '../middleware/validateRequest';
import { AdjustmentController } from '../controllers/adjustment.controller';
import { createAdjustmentSchema } from '../validators';

const router = Router();
const controller = new AdjustmentController();

router.use(authenticate);

router.get('/summary', authorizePermission('adjustments.read'), authRoute((req, res) => controller.getSummary(req, res)));
router.get('/', authorizePermission('adjustments.read'), authRoute((req, res) => controller.getAdjustments(req, res)));
router.get(
    '/:id',
    authorizePermission('adjustments.read'),
    [param('id').isInt({ min: 1 })],
    validateRequest,
    authRoute((req, res) => controller.getAdjustmentById(req, res)),
);
router.post('/', authorizePermission('adjustments.write'), validateZod(createAdjustmentSchema), authRoute((req, res) => controller.createAdjustment(req, res)));
router.post(
    '/:id/apply',
    authorizePermission('adjustments.apply'),
    [param('id').isInt({ min: 1 })],
    validateRequest,
    authRoute((req, res) => controller.applyAdjustment(req, res)),
);
router.post(
    '/:id/reverse',
    authorizePermission('adjustments.reverse'),
    [param('id').isInt({ min: 1 })],
    validateRequest,
    authRoute((req, res) => controller.reverseAdjustment(req, res)),
);

export default router;

import { Router } from 'express';
import { param } from 'express-validator';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { validateZod } from '../middleware/validateZod';
import { BarterController } from '../controllers/barter.controller';
import {
  barterApproveSchema,
  barterAgreementListQuerySchema,
  barterListQuerySchema,
  barterPostSchema,
  barterPreviewSchema,
  barterReverseSchema,
  createBarterAgreementSchema,
  createBarterBatchSchema,
  createBarterSettlementSchema,
} from '../validators';

const router = Router();
const controller = new BarterController();

router.use(authenticate);

router.get('/summary', authorizePermission('barter.read'), authRoute((req, res) => controller.getSummary(req, res)));
router.get('/agreements', authorizePermission('barter.read'), validateZod(barterAgreementListQuerySchema, 'query'), authRoute((req, res) => controller.getAgreements(req, res)));
router.get('/agreements/:id', authorizePermission('barter.read'), [param('id').isInt({ min: 1 })], validateRequest, authRoute((req, res) => controller.getAgreement(req, res)));
router.post('/agreements', authorizePermission('barter.write'), validateZod(createBarterAgreementSchema), authRoute((req, res) => controller.createAgreement(req, res)));
router.post('/agreements/:id/batches', authorizePermission('barter.write'), [param('id').isInt({ min: 1 })], validateRequest, validateZod(createBarterBatchSchema), authRoute((req, res) => controller.createBatchForAgreement(req, res)));
router.get('/settlements', authorizePermission('barter.read'), validateZod(barterListQuerySchema, 'query'), authRoute((req, res) => controller.getSettlements(req, res)));
router.get('/settlements/:id', authorizePermission('barter.read'), [param('id').isInt({ min: 1 })], validateRequest, authRoute((req, res) => controller.getSettlement(req, res)));
router.post('/preview', authorizePermission('barter.read'), validateZod(barterPreviewSchema), authRoute((req, res) => controller.preview(req, res)));
router.post('/settlements', authorizePermission('barter.write'), validateZod(createBarterSettlementSchema), authRoute((req, res) => controller.createSettlement(req, res)));
router.patch('/settlements/:id/approve', authorizePermission('barter.approve'), [param('id').isInt({ min: 1 })], validateRequest, validateZod(barterApproveSchema), authRoute((req, res) => controller.approveSettlement(req, res)));
router.post('/settlements/:id/post', authorizePermission('barter.post'), [param('id').isInt({ min: 1 })], validateRequest, validateZod(barterPostSchema), authRoute((req, res) => controller.postSettlement(req, res)));
router.post('/settlements/:id/reverse', authorizePermission('barter.post'), [param('id').isInt({ min: 1 })], validateRequest, validateZod(barterReverseSchema), authRoute((req, res) => controller.reverseSettlement(req, res)));

export default router;

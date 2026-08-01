import { Router } from 'express';
import { MaterialController } from '../controllers/material.controller';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import {
  applyBomBackfillSchema,
  createMaterialSchema,
  listMaterialsQuerySchema,
  materialAliasInputSchema,
  materialGovernanceListQuerySchema,
  materialGovernanceRunIdParamSchema,
  materialIdParamSchema,
  updateMaterialSchema,
} from '../validators';

const router = Router();
const controller = new MaterialController();

router.use(authenticate);
router.get('/', authorizePermission('materials.read'), validateZod(listMaterialsQuerySchema, 'query'), authRoute((req, res) => controller.list(req, res)));
router.get('/governance/backfill-candidates', authorizePermission('materials.govern'), validateZod(materialGovernanceListQuerySchema, 'query'), authRoute((req, res) => controller.listBackfillCandidates(req, res)));
router.post('/governance/backfill', authorizePermission('materials.govern'), validateZod(applyBomBackfillSchema), authRoute((req, res) => controller.applyBackfill(req, res)));
router.get('/governance/runs', authorizePermission('materials.govern'), validateZod(materialGovernanceListQuerySchema, 'query'), authRoute((req, res) => controller.listGovernanceRuns(req, res)));
router.post('/governance/runs/:runId/rollback', authorizePermission('materials.govern'), validateZod(materialGovernanceRunIdParamSchema, 'params'), authRoute((req, res) => controller.rollbackGovernanceRun(req, res)));
router.get('/:id', authorizePermission('materials.read'), validateZod(materialIdParamSchema, 'params'), authRoute((req, res) => controller.getById(req, res)));
router.post('/', authorizePermission('materials.write'), validateZod(createMaterialSchema), authRoute((req, res) => controller.create(req, res)));
router.patch('/:id', authorizePermission('materials.write'), validateZod(materialIdParamSchema, 'params'), validateZod(updateMaterialSchema), authRoute((req, res) => controller.update(req, res)));
router.post('/:id/aliases', authorizePermission('materials.write'), validateZod(materialIdParamSchema, 'params'), validateZod(materialAliasInputSchema), authRoute((req, res) => controller.addAlias(req, res)));

export default router;

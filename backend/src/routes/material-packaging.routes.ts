import { Router } from 'express';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { z } from 'zod';
import { createPackagingRevisionSchema, reviewPackagingRevisionSchema } from '../validators/material-packaging';
import { MaterialPackagingService } from '../services/material-packaging.service';

const router = Router({ mergeParams: true });
const params = z.object({ id: z.coerce.number().int().positive(), revisionId: z.coerce.number().int().positive().optional() });
const handle = (action: Parameters<typeof authRoute>[0]) => authRoute(async (req, res, next) => {
  try { await action(req, res, next); } catch (error) {
    const message = error instanceof Error ? error.message : 'PACKAGING_FAILED';
    const duplicate = (error as { code?: string }).code === 'P2002';
    res.status(message === 'PACKAGING_NOT_FOUND' ? 404 : duplicate || message.startsWith('PACKAGING_') || message.startsWith('BOM_UNIT_') ? 409 : 500)
      .json({ success: false, message: duplicate ? 'PACKAGING_REVISION_EXISTS:同一物料、规格、版本已存在；请刷新，不要重复提交' : message });
  }
});
router.use(authenticate);
router.get('/', authorizePermission('materials.read'), validateZod(params, 'params'), handle(async (req,res) => {
  res.json({ success: true, data: await MaterialPackagingService.list(Number(req.params.id)) });
}));
router.post('/', authorizePermission('materials.write'), validateZod(params, 'params'), validateZod(createPackagingRevisionSchema), handle(async (req,res) => {
  res.status(201).json({ success: true, data: await MaterialPackagingService.create(Number(req.params.id),req.body,req.user!.userId) });
}));
for (const [action, status] of [['approve','approved'],['retire','retired']] as const) router.post('/:revisionId/'+action,
  authorizePermission('materials.govern'), validateZod(params,'params'), validateZod(reviewPackagingRevisionSchema), handle(async (req,res) => {
    res.json({ success: true, data: await MaterialPackagingService.transition(Number(req.params.id),Number(req.params.revisionId),status,req.body.expectedUpdatedAt,req.body.reason,req.user!.userId) });
  }));
export default router;

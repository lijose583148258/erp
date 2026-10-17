import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { createDensityRevisionSchema, reviewDensityRevisionSchema } from '../validators/material-density';
import { MaterialDensityService } from '../services/material-density.service';

const router = Router({ mergeParams: true });
const params = z.object({ id: z.coerce.number().int().positive(), revisionId: z.coerce.number().int().positive().optional() });
const handle = (action: Parameters<typeof authRoute>[0]) => authRoute(async (req,res,next) => {
  try { await action(req,res,next); } catch (error) {
    const message = error instanceof Error ? error.message : 'DENSITY_FAILED';
    const duplicate = (error as { code?: string }).code === 'P2002';
    res.status(message === 'DENSITY_NOT_FOUND' ? 404 : duplicate || message.startsWith('DENSITY_') ? 409 : 500)
      .json({ success: false, message: duplicate ? 'DENSITY_REVISION_EXISTS:同一物料/批次/编码/版本已存在，请刷新' : message });
  }
});
// Batch evidence is not exposed merely because a caller may search public master data.
router.use(authenticate, authorizePermission('production.read'));
router.get('/', authorizePermission('materials.read'), validateZod(params,'params'), handle(async (req,res) => {
  res.json({ success: true, data: await MaterialDensityService.list(Number(req.params.id)) });
}));
router.post('/', authorizePermission('materials.write'), validateZod(params,'params'), validateZod(createDensityRevisionSchema), handle(async (req,res) => {
  res.status(201).json({ success: true, data: await MaterialDensityService.create(Number(req.params.id),req.body,req.user!.userId) });
}));
for (const [action,status] of [['approve','approved'],['retire','retired']] as const) router.post('/:revisionId/'+action,
  authorizePermission('materials.govern'), validateZod(params,'params'), validateZod(reviewDensityRevisionSchema), handle(async (req,res) => {
    res.json({ success: true, data: await MaterialDensityService.transition(Number(req.params.id),Number(req.params.revisionId),status,req.body,req.user!.userId) });
  }));
export default router;

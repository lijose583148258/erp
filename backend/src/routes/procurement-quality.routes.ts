import { Router, type Response, type NextFunction } from 'express';
import { authorizePermission, type AuthRequest } from '../middleware/auth';
import { casbinAllowsPermission } from '../permissions/casbinAuthorization';
import { validateZod } from '../middleware/validateZod';
import { idParamSchema } from '../validators';
import { submitIncomingQualityCheckSchema, reviewIncomingQualityCheckSchema } from '../validators/purchase-quality';
import { ProcurementQualityController } from '../controllers/procurement-quality.controller';

// Authentication is owned by the parent procurement router. QC-only users do
// not inherit procurement.read, so no priced order DTO is exposed here.
const router = Router(), controller = new ProcurementQualityController();
async function readQuality(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: '请先登录' });
    const allowed = await casbinAllowsPermission(req.user.role, 'procurement.quality.inspect')
      || await casbinAllowsPermission(req.user.role, 'procurement.quality.release');
    if (!allowed) return res.status(403).json({ success: false, message: '需要来料 QC 测量或 QA 审核权限' });
    return next();
  } catch (error) { return next(error); }
}
router.get('/incoming-quality', readQuality, controller.list);
router.get('/receipts/:id/quality', readQuality, validateZod(idParamSchema, 'params'), controller.get);
router.post('/receipts/:id/quality-checks', authorizePermission('procurement.quality.inspect'), validateZod(idParamSchema, 'params'),
  validateZod(submitIncomingQualityCheckSchema), controller.submit);
router.post('/quality-checks/:id/review', authorizePermission('procurement.quality.release'), validateZod(idParamSchema, 'params'),
  validateZod(reviewIncomingQualityCheckSchema), controller.review);
export default router;

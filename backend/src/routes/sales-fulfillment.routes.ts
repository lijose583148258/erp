import { Router } from 'express';
import { z } from 'zod';
import { authorizePermission, authRoute } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { SalesFulfillmentPlanError, SalesFulfillmentPlanService } from '../services/sales-fulfillment-plan.service';
import { createSalesFulfillmentPlanSchema, approveSalesFulfillmentPlanSchema, closeSalesFulfillmentPlanSchema } from '../validators/sales-fulfillment';
import { logger } from '../utils/logger';

const router = Router({ mergeParams: true });
const params = z.object({ id: z.coerce.number().int().positive(), planId: z.coerce.number().int().positive().optional() });
const handle = (action: Parameters<typeof authRoute>[0]) => authRoute(async (req, res, next) => {
  try { await action(req, res, next); } catch (error) {
    if (error instanceof SalesFulfillmentPlanError) { res.status(error.statusCode).json({ success: false, errorCode: error.code, message: error.message }); return; }
    if ((error as { code?: string }).code === 'P2002') { res.status(409).json({ success: false, errorCode: 'FULFILLMENT_IDEMPOTENCY_CONFLICT', message: '请求键冲突，请先读取原计划，勿改键重复提交' }); return; }
    logger.error('Sales fulfillment plan operation failed', error);
    res.status(500).json({ success: false, message: '供给计划操作失败，请先回读核对结果' });
  }
});
router.get('/', authorizePermission('orders.read'), validateZod(params, 'params'), handle(async (req, res) => {
  res.json({ success: true, data: await SalesFulfillmentPlanService.list(Number(req.params.id), req) });
}));
router.post('/', authorizePermission('orders.update'), validateZod(params, 'params'), validateZod(createSalesFulfillmentPlanSchema), handle(async (req, res) => {
  res.status(201).json({ success: true, data: await SalesFulfillmentPlanService.create(Number(req.params.id), req.body, req) });
}));
router.post('/:planId/approve', authorizePermission('orders.status.manage'), validateZod(params, 'params'), validateZod(approveSalesFulfillmentPlanSchema), handle(async (req, res) => {
  res.json({ success: true, data: await SalesFulfillmentPlanService.approve(Number(req.params.id), Number(req.params.planId), req.body, req) });
}));
router.post('/:planId/close', authorizePermission('orders.status.manage'), validateZod(params, 'params'), validateZod(closeSalesFulfillmentPlanSchema), handle(async (req, res) => {
  res.json({ success: true, data: await SalesFulfillmentPlanService.close(Number(req.params.id), Number(req.params.planId), req.body, req) });
}));
export default router;

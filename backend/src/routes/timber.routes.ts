import { Router, type Request, type Response } from 'express';

const router = Router();

const legacyTimberGone = (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    code: 'LEGACY_TIMBER_API_DISABLED',
    message: 'The legacy timber API is disconnected. Use the barter workspace and /api/barter endpoints instead.',
    replacement: '/api/barter',
    disabledAt: '2026-04-20',
  });
};

// LEGACY DISCONNECTED:
// `/api/timber/*` was an early timber-specific helper. The current business
// model is generalized barter/payment-in-goods, so the old API must not keep
// serving hidden summaries or purchase conversions.
router.all('*', legacyTimberGone);

export default router;

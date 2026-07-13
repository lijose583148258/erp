import { type Request, type Response } from 'express';

const legacyTimberPayload = {
  success: false,
  code: 'LEGACY_TIMBER_API_DISABLED',
  message: 'The legacy timber controller is disconnected. Use the barter workspace and /api/barter endpoints instead.',
  replacement: '/api/barter',
  disabledAt: '2026-04-20',
};

/**
 * LEGACY DISCONNECTED.
 *
 * Keep this class only for compatibility with older imports. It must not
 * calculate timber volume, query timber order rows, or create purchase orders.
 * The business model has moved to generalized barter/payment-in-goods.
 */
export class TimberController {
  calculateVolume(_req: Request, res: Response) {
    return res.status(410).json(legacyTimberPayload);
  }

  getTimberSummary(_req: Request, res: Response) {
    return res.status(410).json(legacyTimberPayload);
  }

  convertToPurchase(_req: Request, res: Response) {
    return res.status(410).json(legacyTimberPayload);
  }
}

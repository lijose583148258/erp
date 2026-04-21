import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { logger } from '../utils/logger';
import { FinanceService } from '../services/finance.service';
import { FinanceReportService } from '../services/finance-report.service';

export class FinanceController {
  async getSummary(req: AuthRequest, res: Response) {
    try {
      const data = await FinanceService.getSummary(req);
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load finance summary', error);
      const message = error instanceof Error ? error.message : 'Failed to load finance summary';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }

  async getWorkspace(req: AuthRequest, res: Response) {
    try {
      const [summary, ledger, cashflow] = await Promise.all([
        FinanceService.getSummary(req),
        FinanceReportService.getLedger(req),
        FinanceReportService.getCashflow(req),
      ]);

      res.json({
        success: true,
        data: { summary, ledger, cashflow },
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load finance workspace', error);
      const message = error instanceof Error ? error.message : 'Failed to load finance workspace';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }
}

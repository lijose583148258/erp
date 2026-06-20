import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { logger } from '../utils/logger';
import { FinanceService } from '../services/finance.service';
import { FinanceReportService } from '../services/finance-report.service';
import {
  ReceivableAdjustmentService,
  getReceivableAdjustmentConflictMessage,
} from '../services/receivable-adjustment.service';

const toPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

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

  async listReceivableAdjustments(req: AuthRequest, res: Response) {
    try {
      const page = toPositiveInt(req.query.page, 1);
      const pageSize = Math.min(toPositiveInt(req.query.pageSize, 20), 100);
      const data = await ReceivableAdjustmentService.listAdjustments({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        adjustmentType: typeof req.query.adjustmentType === 'string' ? req.query.adjustmentType : undefined,
        orderId: req.query.orderId ? Number(req.query.orderId) : undefined,
        customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
        page,
        pageSize,
      });
      res.json({
        success: true,
        data: data.items,
        meta: {
          page,
          pageSize,
          total: data.total,
          totalPages: Math.ceil(data.total / pageSize),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to list receivable adjustments', error);
      const message = error instanceof Error ? error.message : 'Failed to list receivable adjustments';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }

  async createReceivableAdjustment(req: AuthRequest, res: Response) {
    try {
      const record = await ReceivableAdjustmentService.createAdjustment({
        orderId: Number(req.body.orderId),
        customerId: req.body.customerId === undefined || req.body.customerId === null ? null : Number(req.body.customerId),
        adjustmentType: String(req.body.adjustmentType),
        amount: Number(req.body.amount),
        currency: req.body.currency ? String(req.body.currency) : 'CNY',
        exchangeRate: req.body.exchangeRate === undefined || req.body.exchangeRate === null ? 1 : Number(req.body.exchangeRate),
        baseAmount: req.body.baseAmount === undefined || req.body.baseAmount === null ? null : Number(req.body.baseAmount),
        reason: String(req.body.reason || ''),
        evidenceJson: req.body.evidenceJson ? String(req.body.evidenceJson) : null,
        note: req.body.note ? String(req.body.note) : null,
      }, req.user!.userId);

      res.status(201).json({ success: true, data: record } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create receivable adjustment', error);
      const conflictMessage = getReceivableAdjustmentConflictMessage(error);
      if (conflictMessage) {
        return res.status(409).json({ success: false, message: conflictMessage } as ApiResponse);
      }
      const message = error instanceof Error ? error.message : 'Failed to create receivable adjustment';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }

  async postReceivableAdjustment(req: AuthRequest, res: Response) {
    try {
      const result = await ReceivableAdjustmentService.postAdjustment(Number(req.params.id), req.user!.userId);
      res.json({ success: true, data: result } as ApiResponse);
    } catch (error) {
      logger.error('Failed to post receivable adjustment', error);
      const conflictMessage = getReceivableAdjustmentConflictMessage(error);
      if (conflictMessage) {
        return res.status(409).json({ success: false, message: conflictMessage } as ApiResponse);
      }
      const message = error instanceof Error ? error.message : 'Failed to post receivable adjustment';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }

  async reverseReceivableAdjustment(req: AuthRequest, res: Response) {
    try {
      const result = await ReceivableAdjustmentService.reverseAdjustment(
        Number(req.params.id),
        req.user!.userId,
        req.body?.note ? String(req.body.note) : null,
      );
      res.json({ success: true, data: result } as ApiResponse);
    } catch (error) {
      logger.error('Failed to reverse receivable adjustment', error);
      const conflictMessage = getReceivableAdjustmentConflictMessage(error);
      if (conflictMessage) {
        return res.status(409).json({ success: false, message: conflictMessage } as ApiResponse);
      }
      const message = error instanceof Error ? error.message : 'Failed to reverse receivable adjustment';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }
}

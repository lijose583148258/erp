import { Response } from 'express';
import { logger } from '../../utils/logger';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { CollectionQueryService } from '../../services/collection-query.service';
import { CollectionService } from '../../services/collection.service';
import { getLoadErrorMessage } from './collection-controller.helpers';

export class CollectionQueryController {
  async getSummary(req: AuthRequest, res: Response) {
    try {
      const summary = await CollectionService.getReceivablesSnapshot(req);
      res.json({ success: true, data: { ...summary } } as ApiResponse);
    } catch (error) {
      const err = error instanceof Error ? { message: error.message, stack: error.stack } : error;
      logger.error('Failed to load collection summary', err);
      res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'development' && error instanceof Error
          ? error.message
          : 'Failed to load collection summary',
      } as ApiResponse);
    }
  }

  async getLedger(req: AuthRequest, res: Response) {
    try {
      const { page = 1, pageSize, status, method, customerId } = req.query;
      const result = await CollectionQueryService.getLedger(req, {
        page: Number(page) || 1,
        pageSize: pageSize ? Number(pageSize) : undefined,
        status: status ? String(status) : undefined,
        method: method ? String(method) : undefined,
        customerId: customerId ? Number(customerId) : undefined,
      });

      res.json({ success: true, ...result } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load collection ledger', error);
      res.status(500).json({ success: false, message: 'Failed to load collection ledger' } as ApiResponse);
    }
  }

  async getOverdueOrders(req: AuthRequest, res: Response) {
    try {
      const { page = 1, pageSize } = req.query;
      const result = await CollectionQueryService.getOverdueOrders(req, {
        page: Number(page) || 1,
        pageSize: pageSize ? Number(pageSize) : undefined,
      });

      res.json({ success: true, ...result } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load overdue orders', error);
      res.status(500).json({ success: false, message: 'Failed to load overdue orders' } as ApiResponse);
    }
  }

  async getMilestones(req: AuthRequest, res: Response) {
    try {
      const { status } = req.query;
      const data = await CollectionQueryService.getMilestones(req, { status: status ? String(status) : undefined });
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load milestones', error);
      res.status(500).json({ success: false, message: 'Failed to load milestones' } as ApiResponse);
    }
  }

  async getWorkbench(req: AuthRequest, res: Response) {
    try {
      const [
        summaryResult,
        ledgerResult,
        overdueResult,
        milestoneResult,
        promiseResult,
        disputeResult,
        holdResult,
      ] = await Promise.allSettled([
        CollectionService.getReceivablesSnapshot(req),
        CollectionQueryService.getLedger(req, { page: 1, pageSize: 100 }),
        CollectionQueryService.getOverdueOrders(req, { page: 1, pageSize: 100 }),
        CollectionQueryService.getMilestones(req),
        CollectionService.getPromises(req),
        CollectionService.getDisputes(req),
        CollectionService.getHolds(req),
      ]);

      const errors: string[] = [];
      const unwrap = <T>(label: string, result: PromiseSettledResult<T>, fallback: T) => {
        if (result.status === 'fulfilled') return result.value;
        errors.push(getLoadErrorMessage(label, result.reason));
        return fallback;
      };

      const emptyMeta = { page: 1, pageSize: 100, total: 0, totalPages: 0 };
      const ledger = unwrap('ledger', ledgerResult, { data: [], meta: emptyMeta });
      const overdue = unwrap('overdue', overdueResult, { data: [], meta: emptyMeta });

      res.json({
        success: true,
        data: {
          summary: unwrap('summary', summaryResult, null),
          ledger: ledger.data,
          overdue: overdue.data,
          milestones: unwrap('milestones', milestoneResult, []),
          promises: unwrap('promises', promiseResult, []),
          disputes: unwrap('disputes', disputeResult, []),
          holds: unwrap('holds', holdResult, []),
          errors,
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load collection workbench', error);
      res.status(500).json({ success: false, message: 'Failed to load collection workbench' } as ApiResponse);
    }
  }

  async getPromises(req: AuthRequest, res: Response) {
    try {
      const data = await CollectionService.getPromises(req);
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load collection promises', error);
      res.status(500).json({ success: false, message: 'Failed to load collection promises' } as ApiResponse);
    }
  }

  async getDisputes(req: AuthRequest, res: Response) {
    try {
      const data = await CollectionService.getDisputes(req);
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load collection disputes', error);
      res.status(500).json({ success: false, message: 'Failed to load collection disputes' } as ApiResponse);
    }
  }

  async getHolds(req: AuthRequest, res: Response) {
    try {
      const data = await CollectionService.getHolds(req);
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load collection holds', error);
      res.status(500).json({ success: false, message: 'Failed to load collection holds' } as ApiResponse);
    }
  }
}

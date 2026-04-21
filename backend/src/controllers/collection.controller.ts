import { Response } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { CollectionQueryService } from '../services/collection-query.service';
import { CollectionReminderService } from '../services/collection-reminder.service';
import { CollectionService } from '../services/collection.service';
import { CollectionStateService } from '../services/collection-state.service';
import {
  canUseOperationalDataScope,
  canUseOrderForBusinessWrite,
} from '../utils/recordAccess';

const getConflictMessage = (error: unknown) => error instanceof Error ? error.message : null;
const getLoadErrorMessage = (label: string, error: unknown) => `${label}: ${error instanceof Error ? error.message : String(error)}`;
const collectionOrderScopeSelect = {
  id: true,
  customerId: true,
  createdBy: true,
  customer: {
    select: {
      salespersonId: true,
      poolState: true,
      segment: true,
    },
  },
} as const;

export class CollectionController {
  private async logAudit(req: AuthRequest, action: string, resourceId: number, details: string) {
    await prisma.auditLog.create({
      data: {
        userId: req.user!.userId,
        action,
        resource: 'collection',
        resourceId,
        details,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      },
    });
  }

  private canManageFinanceCollections(req: AuthRequest) {
    return canUseOperationalDataScope(req, 'finance_visible');
  }

  private sendForbidden(res: Response, message = 'You do not have permission to operate this collection record.') {
    return res.status(403).json({ success: false, message } as ApiResponse);
  }

  private async requireOrderAccess(req: AuthRequest, res: Response, orderId: number) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: collectionOrderScopeSelect,
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' } as ApiResponse);
      return null;
    }

    if (!canUseOrderForBusinessWrite(req, order)) {
      this.sendForbidden(res, 'You do not have permission to operate collections for this order.');
      return null;
    }

    return order;
  }

  private async requireFinanceScope(req: AuthRequest, res: Response) {
    if (!this.canManageFinanceCollections(req)) {
      this.sendForbidden(res, 'Finance collection scope is required for this operation.');
      return false;
    }

    return true;
  }

  async getSummary(req: AuthRequest, res: Response) {
    try {
      const summary = await CollectionService.getReceivablesSnapshot(req);
      res.json({ success: true, data: { ...summary } } as ApiResponse);
    } catch (error) {
      const err = error instanceof Error ? { message: error.message, stack: error.stack } : error;
      logger.error('Failed to load collection summary', err);
      res.status(500).json({ success: false, message: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : 'Failed to load collection summary' } as ApiResponse);
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

  async syncOverdue(req: AuthRequest, res: Response) {
    try {
      if (!(await this.requireFinanceScope(req, res))) return;

      const count = await CollectionStateService.syncAllCustomerOverdueAmounts();

      await this.logAudit(req, 'SYNC_OVERDUE', 0, `Synced overdue amounts for ${count} customers`);

      res.json({
        success: true,
        message: 'Overdue amounts synced',
        data: { updatedCustomers: count },
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to sync overdue amounts', error);
      res.status(500).json({ success: false, message: 'Failed to sync overdue amounts' } as ApiResponse);
    }
  }

  async verifyPaymentRecord(req: AuthRequest, res: Response) {
    try {
      const { paymentId } = req.params;
      if (!(await this.requireFinanceScope(req, res))) return;

      const payment = await prisma.paymentRecord.findUnique({
        where: { id: Number(paymentId) },
        select: {
          id: true,
          orderId: true,
          order: {
            select: collectionOrderScopeSelect,
          },
        },
      });

      if (!payment) {
        return res.status(404).json({ success: false, message: 'Payment record not found' } as ApiResponse);
      }

      if (!canUseOrderForBusinessWrite(req, payment.order)) {
        return this.sendForbidden(res, 'You do not have permission to verify payments for this order.');
      }

      if (payment.order.createdBy === req.user!.userId) {
        return this.sendForbidden(res, '职责分离：订单创建者不能验证自己订单的付款记录。');
      }

      const result = await CollectionStateService.verifyPaymentRecord(payment.id, req.user!.userId);

      res.json({
        success: true,
        message: result.alreadyVerified ? 'Payment already verified' : 'Payment verified',
        data: result,
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to verify payment', error);
      res.status(500).json({ success: false, message: 'Failed to verify payment' } as ApiResponse);
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

  async createPromise(req: AuthRequest, res: Response) {
    try {
      const { customerId, orderId, promisedAmount, promisedAt, channel = 'phone', contactName, contactPhone, note } = req.body;
      const order = await this.requireOrderAccess(req, res, Number(orderId));
      if (!order) return;

      if (order.customerId !== Number(customerId)) {
        return res.status(400).json({ success: false, message: 'Promise customer must match the order customer.' } as ApiResponse);
      }

      const promisedDate = new Date(promisedAt);
      if (Number.isNaN(promisedDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid promised date' } as ApiResponse);
      }
      const record = await CollectionService.createPromiseToPay({
        customerId: Number(customerId),
        orderId: Number(orderId),
        promisedAmount: Number(promisedAmount),
        promisedAt: promisedDate,
        channel,
        contactName,
        contactPhone,
        note,
        createdBy: req.user!.userId,
      });

      await this.logAudit(req, 'PROMISE_CREATE', record.id, JSON.stringify({
        promiseNo: record.promiseNo,
        customerId: record.customerId,
        orderId: record.orderId,
        promisedAmount: record.promisedAmount,
        promisedAt: record.promisedAt,
      }));

      res.status(201).json({ success: true, data: record } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create promise-to-pay', error);
      res.status(500).json({ success: false, message: 'Failed to create promise-to-pay' } as ApiResponse);
    }
  }

  async updatePromiseStatus(req: AuthRequest, res: Response) {
    try {
      const { promiseId } = req.params;
      const { status } = req.body;
      const promise = await prisma.collectionPromise.findUnique({
        where: { id: Number(promiseId) },
        select: {
          id: true,
          order: {
            select: collectionOrderScopeSelect,
          },
        },
      });

      if (!promise) {
        return res.status(404).json({ success: false, message: 'Promise record not found' } as ApiResponse);
      }

      if (!canUseOrderForBusinessWrite(req, promise.order)) {
        return this.sendForbidden(res, 'You do not have permission to update this promise record.');
      }

      const updated = await CollectionService.updatePromiseStatus(Number(promiseId), status);

      await this.logAudit(req, 'PROMISE_UPDATE', Number(promiseId), JSON.stringify({ status }));

      res.json({ success: true, data: updated } as ApiResponse);
    } catch (error) {
      logger.error('Failed to update promise status', error);
      const conflictMessage = getConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({ success: false, message: conflictMessage || 'Failed to update promise status' } as ApiResponse);
    }
  }

  async createDispute(req: AuthRequest, res: Response) {
    try {
      const { customerId, orderId, disputedAmount, reasonCategory, reason, evidenceJson, note } = req.body;
      const order = await this.requireOrderAccess(req, res, Number(orderId));
      if (!order) return;

      if (order.customerId !== Number(customerId)) {
        return res.status(400).json({ success: false, message: 'Dispute customer must match the order customer.' } as ApiResponse);
      }

      const record = await CollectionService.createDispute({
        customerId: Number(customerId),
        orderId: Number(orderId),
        disputedAmount: disputedAmount === undefined || disputedAmount === null ? null : Number(disputedAmount),
        reasonCategory,
        reason,
        evidenceJson: evidenceJson || null,
        note,
        createdBy: req.user!.userId,
      });

      await this.logAudit(req, 'DISPUTE_CREATE', record.id, JSON.stringify({
        disputeNo: record.disputeNo,
        customerId: record.customerId,
        orderId: record.orderId,
        reasonCategory: record.reasonCategory,
        disputedAmount: record.disputedAmount,
      }));

      res.status(201).json({ success: true, data: record } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create dispute', error);
      res.status(500).json({ success: false, message: 'Failed to create dispute' } as ApiResponse);
    }
  }

  async updateDisputeStatus(req: AuthRequest, res: Response) {
    try {
      const { disputeId } = req.params;
      const { status } = req.body;
      const dispute = await prisma.collectionDispute.findUnique({
        where: { id: Number(disputeId) },
        select: {
          id: true,
          order: {
            select: collectionOrderScopeSelect,
          },
        },
      });

      if (!dispute) {
        return res.status(404).json({ success: false, message: 'Dispute record not found' } as ApiResponse);
      }

      if (!canUseOrderForBusinessWrite(req, dispute.order)) {
        return this.sendForbidden(res, 'You do not have permission to update this dispute record.');
      }

      const updated = await CollectionService.updateDisputeStatus(Number(disputeId), status);

      await this.logAudit(req, 'DISPUTE_UPDATE', Number(disputeId), JSON.stringify({ status }));

      res.json({ success: true, data: updated } as ApiResponse);
    } catch (error) {
      logger.error('Failed to update dispute status', error);
      const conflictMessage = getConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({ success: false, message: conflictMessage || 'Failed to update dispute status' } as ApiResponse);
    }
  }

  async setCustomerHold(req: AuthRequest, res: Response) {
    try {
      const { customerId } = req.params;
      const { type, reason, source = 'manual' } = req.body;
      if (!(await this.requireFinanceScope(req, res))) return;

      const existing = await prisma.customer.findUnique({
        where: { id: Number(customerId) },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Customer not found' } as ApiResponse);
      }

      const customer = await CollectionService.setCustomerHold(Number(customerId), type, reason, source);

      await this.logAudit(req, 'CUSTOMER_HOLD_SET', Number(customerId), JSON.stringify({ type, reason, source }));

      res.json({ success: true, data: customer } as ApiResponse);
    } catch (error) {
      logger.error('Failed to set customer hold', error);
      res.status(500).json({ success: false, message: 'Failed to set customer hold' } as ApiResponse);
    }
  }

  async releaseCustomerHold(req: AuthRequest, res: Response) {
    try {
      const { customerId } = req.params;
      const { type } = req.body;
      if (!(await this.requireFinanceScope(req, res))) return;

      const existing = await prisma.customer.findUnique({
        where: { id: Number(customerId) },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Customer not found' } as ApiResponse);
      }

      const customer = await CollectionService.releaseCustomerHold(Number(customerId), type);

      await this.logAudit(req, 'CUSTOMER_HOLD_RELEASE', Number(customerId), JSON.stringify({ type }));

      res.json({ success: true, data: customer } as ApiResponse);
    } catch (error) {
      logger.error('Failed to release customer hold', error);
      const conflictMessage = getConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({ success: false, message: conflictMessage || 'Failed to release customer hold' } as ApiResponse);
    }
  }

  async setOrderShipmentHold(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      const { reason, source = 'manual' } = req.body;
      if (!(await this.requireFinanceScope(req, res))) return;

      const orderMeta = await this.requireOrderAccess(req, res, Number(orderId));
      if (!orderMeta) return;

      const order = await CollectionService.setOrderShipmentHold(Number(orderId), reason, source);

      await this.logAudit(req, 'ORDER_SHIPMENT_HOLD_SET', Number(orderId), JSON.stringify({ reason, source }));

      res.json({ success: true, data: order } as ApiResponse);
    } catch (error) {
      logger.error('Failed to set order shipment hold', error);
      res.status(500).json({ success: false, message: 'Failed to set order shipment hold' } as ApiResponse);
    }
  }

  async releaseOrderShipmentHold(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      if (!(await this.requireFinanceScope(req, res))) return;

      const orderMeta = await this.requireOrderAccess(req, res, Number(orderId));
      if (!orderMeta) return;

      const order = await CollectionService.releaseOrderShipmentHold(Number(orderId));

      await this.logAudit(req, 'ORDER_SHIPMENT_HOLD_RELEASE', Number(orderId), 'Released shipment hold');

      res.json({ success: true, data: order } as ApiResponse);
    } catch (error) {
      logger.error('Failed to release order shipment hold', error);
      const conflictMessage = getConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({ success: false, message: conflictMessage || 'Failed to release order shipment hold' } as ApiResponse);
    }
  }

  async createReminder(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      const orderMeta = await this.requireOrderAccess(req, res, Number(orderId));
      if (!orderMeta) return;

      const reminder = await CollectionReminderService.createReminder(req, Number(orderId));

      if (!reminder) {
        return res.status(404).json({ success: false, message: 'Order not found' } as ApiResponse);
      }

      res.json({
        success: true,
        message: 'Reminder created',
        data: reminder,
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create reminder', error);
      res.status(500).json({ success: false, message: 'Failed to create reminder' } as ApiResponse);
    }
  }

  async createBatchReminders(req: AuthRequest, res: Response) {
    try {
      const { orderIds } = req.body as { orderIds?: number[] };
      const uniqueOrderIds = Array.from(new Set((orderIds || []).map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0)));

      if (uniqueOrderIds.length === 0) {
        return res.status(400).json({ success: false, message: 'No order ids provided' } as ApiResponse);
      }

      const scopedOrders = await prisma.order.findMany({
        where: { id: { in: uniqueOrderIds } },
        select: collectionOrderScopeSelect,
      });

      if (scopedOrders.length !== uniqueOrderIds.length) {
        return res.status(404).json({ success: false, message: 'One or more orders were not found' } as ApiResponse);
      }

      if (scopedOrders.some(order => !canUseOrderForBusinessWrite(req, order))) {
        return this.sendForbidden(res, 'You do not have permission to create reminders for one or more orders.');
      }

      const summary = await CollectionService.createReminderBatch(uniqueOrderIds, req.user!.userId);

      await this.logAudit(req, 'COLLECTION_REMINDER_BATCH', uniqueOrderIds[0], JSON.stringify({
        totalCount: summary.totalCount,
        createdCount: summary.createdCount,
        skippedCount: summary.skippedCount,
        orderIds: uniqueOrderIds,
      }));

      res.json({
        success: true,
        message: 'Batch reminders created',
        data: {
          totalCount: summary.totalCount,
          createdCount: summary.createdCount,
          skippedCount: summary.skippedCount,
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create batch reminders', error);
      res.status(500).json({ success: false, message: 'Failed to create batch reminders' } as ApiResponse);
    }
  }
}


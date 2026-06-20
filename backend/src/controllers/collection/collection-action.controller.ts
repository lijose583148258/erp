import { Response } from 'express';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { CollectionReminderService } from '../../services/collection-reminder.service';
import { CollectionService } from '../../services/collection.service';
import { getCollectionMutationConflictMessage } from '../../services/collection-mutation.service';
import { CollectionStateService } from '../../services/collection-state.service';
import { canUseOrderForBusinessWrite } from '../../utils/recordAccess';
import {
  collectionOrderScopeSelect,
  getConflictMessage,
  logCollectionAudit,
  requireCollectionOrderAccess,
  requireFinanceCollectionScope,
  sendCollectionForbidden,
} from './collection-controller.helpers';

export class CollectionActionController {
  async syncOverdue(req: AuthRequest, res: Response) {
    try {
      if (!(await requireFinanceCollectionScope(req, res))) return;

      const count = await CollectionStateService.syncAllCustomerOverdueAmounts();

      await logCollectionAudit(req, 'SYNC_OVERDUE', 0, `Synced overdue amounts for ${count} customers`);

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

  async createPromise(req: AuthRequest, res: Response) {
    try {
      const { customerId, orderId, promisedAmount, promisedAt, channel = 'phone', contactName, contactPhone, note } = req.body;
      const order = await requireCollectionOrderAccess(req, res, Number(orderId));
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

      await logCollectionAudit(req, 'PROMISE_CREATE', record.id, JSON.stringify({
        promiseNo: record.promiseNo,
        customerId: record.customerId,
        orderId: record.orderId,
        promisedAmount: record.promisedAmount,
        promisedAt: record.promisedAt,
      }));

      res.status(201).json({ success: true, data: record } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create promise-to-pay', error);
      const conflictMessage = getCollectionMutationConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({
        success: false,
        message: conflictMessage || 'Failed to create promise-to-pay',
      } as ApiResponse);
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
        return sendCollectionForbidden(res, 'You do not have permission to update this promise record.');
      }

      const updated = await CollectionService.updatePromiseStatus(Number(promiseId), status);

      await logCollectionAudit(req, 'PROMISE_UPDATE', Number(promiseId), JSON.stringify({ status }));

      res.json({ success: true, data: updated } as ApiResponse);
    } catch (error) {
      logger.error('Failed to update promise status', error);
      const conflictMessage = getConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({
        success: false,
        message: conflictMessage || 'Failed to update promise status',
      } as ApiResponse);
    }
  }

  async createDispute(req: AuthRequest, res: Response) {
    try {
      const { customerId, orderId, disputedAmount, reasonCategory, reason, evidenceJson, note } = req.body;
      const order = await requireCollectionOrderAccess(req, res, Number(orderId));
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

      await logCollectionAudit(req, 'DISPUTE_CREATE', record.id, JSON.stringify({
        disputeNo: record.disputeNo,
        customerId: record.customerId,
        orderId: record.orderId,
        reasonCategory: record.reasonCategory,
        disputedAmount: record.disputedAmount,
      }));

      res.status(201).json({ success: true, data: record } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create dispute', error);
      const conflictMessage = getCollectionMutationConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({
        success: false,
        message: conflictMessage || 'Failed to create dispute',
      } as ApiResponse);
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
        return sendCollectionForbidden(res, 'You do not have permission to update this dispute record.');
      }

      const updated = await CollectionService.updateDisputeStatus(Number(disputeId), status);

      await logCollectionAudit(req, 'DISPUTE_UPDATE', Number(disputeId), JSON.stringify({ status }));

      res.json({ success: true, data: updated } as ApiResponse);
    } catch (error) {
      logger.error('Failed to update dispute status', error);
      const conflictMessage = getConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({
        success: false,
        message: conflictMessage || 'Failed to update dispute status',
      } as ApiResponse);
    }
  }

  async createReminder(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      const orderMeta = await requireCollectionOrderAccess(req, res, Number(orderId));
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
      const uniqueOrderIds = Array.from(new Set((orderIds || [])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0)));

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
        return sendCollectionForbidden(res, 'You do not have permission to create reminders for one or more orders.');
      }

      const summary = await CollectionService.createReminderBatch(uniqueOrderIds, req.user!.userId);

      await logCollectionAudit(req, 'COLLECTION_REMINDER_BATCH', uniqueOrderIds[0], JSON.stringify({
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

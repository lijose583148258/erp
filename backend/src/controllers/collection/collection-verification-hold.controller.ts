import { Response } from 'express';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { CollectionService } from '../../services/collection.service';
import {
  CollectionStateService,
  getPaymentVerificationConflictMessage,
} from '../../services/collection-state.service';
import { canUseOrderForCollectionWrite } from '../../utils/recordAccess';
import {
  collectionOrderScopeSelect,
  getConflictMessage,
  logCollectionAudit,
  requireCollectionOrderAccess,
  requireFinanceCollectionScope,
  sendCollectionForbidden,
} from './collection-controller.helpers';

export class CollectionVerificationHoldController {
  async verifyPaymentRecord(req: AuthRequest, res: Response) {
    try {
      const { paymentId } = req.params;
      if (!(await requireFinanceCollectionScope(req, res))) return;

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

      if (!canUseOrderForCollectionWrite(req, payment.order)) {
        return sendCollectionForbidden(res, 'You do not have permission to verify payments for this order.');
      }

      if (payment.order.createdBy === req.user!.userId) {
        return sendCollectionForbidden(res, '职责分离：订单创建者不能验证自己订单的付款记录。');
      }

      const result = await CollectionStateService.verifyPaymentRecord(payment.id, req.user!.userId);

      res.json({
        success: true,
        message: result.alreadyVerified ? 'Payment already verified' : 'Payment verified',
        data: result,
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to verify payment', error);
      const conflictMessage = getPaymentVerificationConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({
        success: false,
        message: conflictMessage || 'Failed to verify payment',
      } as ApiResponse);
    }
  }

  async setCustomerHold(req: AuthRequest, res: Response) {
    try {
      const { customerId } = req.params;
      const { type, reason, source = 'manual' } = req.body;
      if (!(await requireFinanceCollectionScope(req, res))) return;

      const existing = await prisma.customer.findUnique({
        where: { id: Number(customerId) },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Customer not found' } as ApiResponse);
      }

      const customer = await CollectionService.setCustomerHold(Number(customerId), type, reason, source);

      await logCollectionAudit(req, 'CUSTOMER_HOLD_SET', Number(customerId), JSON.stringify({ type, reason, source }));

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
      if (!(await requireFinanceCollectionScope(req, res))) return;

      const existing = await prisma.customer.findUnique({
        where: { id: Number(customerId) },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Customer not found' } as ApiResponse);
      }

      const customer = await CollectionService.releaseCustomerHold(Number(customerId), type);

      await logCollectionAudit(req, 'CUSTOMER_HOLD_RELEASE', Number(customerId), JSON.stringify({ type }));

      res.json({ success: true, data: customer } as ApiResponse);
    } catch (error) {
      logger.error('Failed to release customer hold', error);
      const conflictMessage = getConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({
        success: false,
        message: conflictMessage || 'Failed to release customer hold',
      } as ApiResponse);
    }
  }

  async setOrderShipmentHold(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      const { reason, source = 'manual' } = req.body;
      if (!(await requireFinanceCollectionScope(req, res))) return;

      const orderMeta = await requireCollectionOrderAccess(req, res, Number(orderId));
      if (!orderMeta) return;

      const order = await CollectionService.setOrderShipmentHold(Number(orderId), reason, source);

      await logCollectionAudit(req, 'ORDER_SHIPMENT_HOLD_SET', Number(orderId), JSON.stringify({ reason, source }));

      res.json({ success: true, data: order } as ApiResponse);
    } catch (error) {
      logger.error('Failed to set order shipment hold', error);
      res.status(500).json({ success: false, message: 'Failed to set order shipment hold' } as ApiResponse);
    }
  }

  async releaseOrderShipmentHold(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;
      if (!(await requireFinanceCollectionScope(req, res))) return;

      const orderMeta = await requireCollectionOrderAccess(req, res, Number(orderId));
      if (!orderMeta) return;

      const order = await CollectionService.releaseOrderShipmentHold(Number(orderId));

      await logCollectionAudit(req, 'ORDER_SHIPMENT_HOLD_RELEASE', Number(orderId), 'Released shipment hold');

      res.json({ success: true, data: order } as ApiResponse);
    } catch (error) {
      logger.error('Failed to release order shipment hold', error);
      const conflictMessage = getConflictMessage(error);
      res.status(conflictMessage ? 409 : 500).json({
        success: false,
        message: conflictMessage || 'Failed to release order shipment hold',
      } as ApiResponse);
    }
  }
}

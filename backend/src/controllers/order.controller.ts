import { Response } from 'express';
// N5修复：ExcelJS 由 OrderWorkspaceService 内部使用，此处无需引入
import prisma from '../config/database';
import { CreditEngine } from '../utils/CreditEngine';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { OrderWorkspaceService } from '../services/order-workspace.service';
import { OrderUpdateRejectedError, OrderUpdateService } from '../services/order-update.service';
import { buildOrderItemsAndTotals } from '../services/order-item-normalization';
import { resolveOrderItemMaterialIdentities } from '../services/order-item-material-identity';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { publishRealtimeNotification } from '../services/realtime-notification.service';
import { SearchIndexService } from '../services/search-index.service';
import { publishWebhookEvent } from '../services/webhook.service';
import { writeOrderAuditLog } from '../services/order-audit.service';
import { compareAndSetOrderStatus } from '../services/order-status-transition.service';
import { isMaterialReleaseReadinessError } from '../services/material-release-readiness.service';
import { exportOrders as exportOrderRows, importOrders as importOrderRows } from './order-io.controller';
import { recordOrderPayment, verifyOrderPayment } from './order-payment.controller';
import {
    buildOrderDataScopeWhere,
    canUseCustomerForBusinessWrite,
    canUseOrderForBusinessWrite,
    mergeWhereAnd,
} from '../utils/recordAccess';
import {
    ORDER_STATUS_TRANSITIONS,
    buildCreateOrderAuditDetails,
} from './order/order-controller.helpers';

class OrderCreationRejectedError extends Error {
    constructor(
        readonly statusCode: number,
        message: string,
        readonly data?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'OrderCreationRejectedError';
    }
}

export class OrderController {
    async getOrders(req: AuthRequest, res: Response) {
        try {
            const result = await OrderWorkspaceService.getOrders(
                req.query as any,
                req,
            );

            return res.json({
                success: true,
                data: result.data,
                meta: result.meta,
            } as ApiResponse);
        } catch (error) {
            logger.error('Get orders error:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    async getOrderStats(req: AuthRequest, res: Response) {
        try {
            const data = await OrderWorkspaceService.getOrderStats(req);
            return res.json({ success: true, data } as ApiResponse);
        } catch (error) {
            logger.error('Get order stats error:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    async getOrderById(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const order = await OrderWorkspaceService.getOrderById(Number(id), req);

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: '订单不存在，请刷新后重试。',
                } as ApiResponse);
            }

            return res.json({
                success: true,
                data: order,
            } as ApiResponse);
        } catch (error) {
            logger.error('Get order detail error:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    async createOrder(req: AuthRequest, res: Response) {
        try {
            const { customerId, items, paymentTerms = 30, notes, discountAmount = 0, contractId } = req.body;

            const orderNo = buildBusinessNo('ORD');
            const { orderItems, totalAmount } = buildOrderItemsAndTotals(items);

            const finalAmount = totalAmount - Number(discountAmount);
            if (finalAmount < 0) {
                return res.status(400).json({
                    success: false,
                    message: '折扣金额不能超过订单总额。',
                } as ApiResponse);
            }

            const createdOrder = await withDbRetry(() => prisma.$transaction(async (tx) => {
                const governedOrderItems = await resolveOrderItemMaterialIdentities(tx, orderItems);
                // Serialize credit decisions for one customer before reading exposure.
                // Rejections throw so this row touch is rolled back with the attempt.
                const customer = await tx.customer.update({
                    where: { id: Number(customerId) },
                    data: { updatedAt: new Date() },
                    select: {
                        id: true,
                        name: true,
                        nameZh: true,
                        nameEn: true,
                        nameVi: true,
                        status: true,
                        salespersonId: true,
                        poolState: true,
                        segment: true,
                    },
                }).catch((error) => {
                    if ((error as { code?: string }).code === 'P2025') {
                        throw new OrderCreationRejectedError(400, '客户不存在，请刷新后重试。');
                    }
                    throw error;
                });

                if (customer.status !== 'active') {
                    throw new OrderCreationRejectedError(400, '只能为启用状态的客户创建订单。');
                }
                if (!canUseCustomerForBusinessWrite(req, customer)) {
                    throw new OrderCreationRejectedError(403, '无权为该客户创建订单。');
                }

                const creditCheck = await CreditEngine.checkOrder(Number(customerId), finalAmount, tx);
                if (!creditCheck.allow) {
                    throw new OrderCreationRejectedError(
                        403,
                        creditCheck.reason || '客户授信校验未通过。',
                        { exposure: creditCheck.exposure },
                    );
                }

                const newOrder = await tx.order.create({
                    data: {
                        orderNo,
                        customerId,
                        totalAmount,
                        discountAmount: Number(discountAmount),
                        finalAmount,
                        paymentTerms,
                        notes,
                        status: 'pending',
                        contractId: contractId ? Number(contractId) : null,
                        createdBy: req.user!.userId,
                        items: { create: governedOrderItems },
                    },
                    include: {
                        items: true,
                        customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
                    },
                });

                return newOrder;
            }), { label: 'createOrder' });

            await writeOrderAuditLog(req, {
                action: 'CREATE',
                resourceId: createdOrder.id,
                details: buildCreateOrderAuditDetails({
                    orderNo,
                    customer: createdOrder.customer,
                    finalAmount,
                }),
            });
            SearchIndexService.scheduleOrderSync(createdOrder.id);

            const order = await OrderWorkspaceService.getOrderById(createdOrder.id, req);
            publishRealtimeNotification({
                type: 'order.created',
                title: 'Order created',
                message: `订单 ${orderNo} 已创建`,
                resourceType: 'order',
                resourceId: createdOrder.id,
                severity: 'success',
            });
            publishWebhookEvent({
                type: 'order.created',
                resourceType: 'order',
                resourceId: createdOrder.id,
                data: { orderNo, finalAmount },
            });

            logger.info(`Order created: ${orderNo}`);
            return res.status(201).json({
                success: true,
                data: order || createdOrder,
                message: '订单创建成功。',
            } as ApiResponse);
        } catch (error) {
            if (error instanceof OrderCreationRejectedError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message,
                    data: error.data,
                } as ApiResponse);
            }
            const err = error instanceof Error ? { message: error.message, stack: error.stack } : error;
            logger.error('Create order error:', err);
            return res.status(500).json({
                success: false,
                message: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : '服务器内部错误',
            } as ApiResponse);
        }
    }

    async updateOrder(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            const updatedOrder = await OrderUpdateService.updateOrder(Number(id), updateData, req);

            await writeOrderAuditLog(req, {
                action: 'UPDATE',
                resourceId: updatedOrder.id,
                details: `更新订单: ${updatedOrder.orderNo}`,
            });
            SearchIndexService.scheduleOrderSync(updatedOrder.id);

            const order = await OrderWorkspaceService.getOrderById(updatedOrder.id, req);
            publishRealtimeNotification({
                type: 'order.updated',
                title: 'Order updated',
                message: `订单 ${updatedOrder.orderNo} 已更新`,
                resourceType: 'order',
                resourceId: updatedOrder.id,
                severity: 'info',
            });
            publishWebhookEvent({
                type: 'order.updated',
                resourceType: 'order',
                resourceId: updatedOrder.id,
                data: { orderNo: updatedOrder.orderNo },
            });

            return res.json({
                success: true,
                data: order || updatedOrder,
                message: '订单更新成功。',
            } as ApiResponse);
        } catch (error) {
            if (error instanceof OrderUpdateRejectedError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message,
                    data: error.data,
                } as ApiResponse);
            }
            logger.error('Update order error:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    async updateOrderStatus(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const targetStatus = String(status);

            const existing = await prisma.order.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    orderNo: true,
                    status: true,
                    createdBy: true,  // H5修复：用于职责分离检查
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: '订单不存在，请刷新后重试。',
                } as ApiResponse);
            }

            if (existing.status === targetStatus) {
                const order = await OrderWorkspaceService.getOrderById(existing.id, req);
                return res.json({
                    success: true,
                    data: order || existing,
                    message: '订单状态未变化。',
                } as ApiResponse);
            }

            if (!canUseOrderForBusinessWrite(req, existing)) {
                return res.status(403).json({
                    success: false,
                    message: '无权变更该订单状态。',
                } as ApiResponse);
            }

            const allowedTransitions = ORDER_STATUS_TRANSITIONS[existing.status] || [];
            if (!allowedTransitions.includes(targetStatus)) {
                return res.status(400).json({
                    success: false,
                    message: `订单状态不能从 ${existing.status} 变更为 ${targetStatus}。`,
                } as ApiResponse);
            }

            // H5修复：职责分离 — 创建者不能审批自己的订单
            if (targetStatus === 'confirmed' && existing.createdBy === req.user!.userId) {
                return res.status(403).json({
                    success: false,
                    message: '职责分离：订单创建者不能审批自己的订单。',
                } as ApiResponse);
            }

            if (['shipped', 'delivered'].includes(targetStatus)) {
                const shipmentCheck = await CreditEngine.checkShipment(Number(id));
                if (!shipmentCheck.allow) {
                    return res.status(403).json({
                        success: false,
                        message: shipmentCheck.reason,
                    } as ApiResponse);
                }
            }

            const transitioned = await prisma.$transaction(tx => compareAndSetOrderStatus(tx, {
                orderId: Number(id),
                expectedStatus: existing.status,
                targetStatus,
            }));
            if (!transitioned) {
                return res.status(409).json({
                    success: false,
                    message: '订单状态已被其他操作更新，请刷新后重试。',
                    errorCode: 'ORDER_STATUS_CONFLICT',
                } as ApiResponse);
            }
            const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: Number(id) } });

            await writeOrderAuditLog(req, {
                action: 'STATUS_CHANGE',
                resourceId: updatedOrder.id,
                details: `订单状态变更: ${updatedOrder.orderNo} -> ${targetStatus}`,
            });

            const order = await OrderWorkspaceService.getOrderById(updatedOrder.id, req);
            publishRealtimeNotification({
                type: 'order.status_changed',
                title: 'Order status changed',
                message: `订单 ${updatedOrder.orderNo} 状态已更新为 ${targetStatus}`,
                resourceType: 'order',
                resourceId: updatedOrder.id,
                severity: 'info',
            });
            publishWebhookEvent({
                type: 'order.status_changed',
                resourceType: 'order',
                resourceId: updatedOrder.id,
                data: { orderNo: updatedOrder.orderNo, status: targetStatus },
            });

            return res.json({
                success: true,
                data: order || updatedOrder,
                message: '订单状态更新成功。',
            } as ApiResponse);
        } catch (error) {
            logger.error('Update order status error:', error);
            if (isMaterialReleaseReadinessError(error)) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: '订单仍可继续保存为草稿；确认前请先修复未关联、未发布或单位不一致的物料行。',
                    errorCode: error.message,
                    details: error.details,
                    timestamp: new Date().toISOString(),
                } as ApiResponse);
            }
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    async recordPayment(req: AuthRequest, res: Response) {
        return recordOrderPayment(req, res);
    }

    async verifyPayment(req: AuthRequest, res: Response) {
        return verifyOrderPayment(req, res);
    }

    async importOrders(req: AuthRequest, res: Response) {
        return importOrderRows(req, res);
    }

    /**
     * 获取待发货订单列表
     */
    async getAvailableForShipping(req: AuthRequest, res: Response) {
        try {
            const orders = await prisma.order.findMany({
                where: mergeWhereAnd(
                    {
                        status: 'confirmed',
                        paymentStatus: { in: ['paid', 'partial'] }, // 逻辑要求：部分支付或全款后可发货
                    },
                    buildOrderDataScopeWhere(req, { includeFinanceAll: true, includeWarehouseAll: true }),
                ),
                select: {
                    id: true,
                    orderNo: true,
                    customer: { select: { id: true, nameZh: true, nameEn: true, nameVi: true } },
                    items: true,
                }
            });

            return res.json({
                success: true,
                data: orders,
            } as ApiResponse);
        } catch (error) {
            logger.error('获取待发货订单错误:', error);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 手动结案
     */
    async completeOrder(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const order = await prisma.order.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    status: true,
                    paymentStatus: true,
                    createdBy: true,
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                }
            });

            if (!order) {
                return res.status(404).json({ success: false, message: '订单不存在，请刷新后重试。' });
            }
            if (!canUseOrderForBusinessWrite(req, order)) {
                return res.status(403).json({ success: false, message: '无权结案该订单。' });
            }

            // H2修复：业务校验 — 必须全款且物流已发或已签收
            if (!['shipped', 'delivered'].includes(order.status) || order.paymentStatus !== 'paid') {
                return res.status(400).json({
                    success: false,
                    message: '只有已发货或已签收且已全额回款的订单才能结案。',
                });
            }

            const completed = await compareAndSetOrderStatus(prisma, {
                orderId: Number(id),
                expectedStatus: order.status,
                targetStatus: 'completed',
                requiredWhere: { paymentStatus: 'paid' },
            });
            if (!completed) {
                return res.status(409).json({
                    success: false,
                    message: '订单状态或回款状态已变化，请刷新后重试。',
                    errorCode: 'ORDER_COMPLETION_CONFLICT',
                } as ApiResponse);
            }
            const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: Number(id) } });

            await writeOrderAuditLog(req, {
                action: 'COMPLETE',
                resourceId: Number(id),
                details: '订单手动结案成功',
            });

            const orderDetail = await OrderWorkspaceService.getOrderById(updatedOrder.id, req);
            publishRealtimeNotification({
                type: 'order.completed',
                title: 'Order completed',
                message: `订单 ${updatedOrder.id} 已结案`,
                resourceType: 'order',
                resourceId: updatedOrder.id,
                severity: 'success',
            });
            publishWebhookEvent({
                type: 'order.completed',
                resourceType: 'order',
                resourceId: updatedOrder.id,
                data: { status: 'completed' },
            });

            return res.json({
                success: true,
                message: '订单结案成功。',
                data: orderDetail || updatedOrder,
            });
        } catch (error) {
            logger.error('订单结案失败:', error);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    async exportOrders(req: AuthRequest, res: Response) {
        return exportOrderRows(req, res);
    }
}

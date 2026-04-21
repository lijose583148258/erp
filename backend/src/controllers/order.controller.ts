import { Response } from 'express';
// N5修复：ExcelJS 由 OrderWorkspaceService 内部使用，此处无需引入
import prisma from '../config/database';
import { CreditEngine } from '../utils/CreditEngine';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { CollectionService } from '../services/collection.service';
import { OrderWorkspaceService } from '../services/order-workspace.service';
import { CollectionStateService } from '../services/collection-state.service';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import {
    buildOrderDataScopeWhere,
    canUseCustomerForBusinessWrite,
    canUseOrderForBusinessWrite,
    mergeWhereAnd,
} from '../utils/recordAccess';

const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['shipped', 'cancelled'],
    shipped: ['delivered', 'completed'],   // H2修复：delivered=物流签收(自动)，completed=手动结案
    delivered: ['completed'],              // H2修复：签收后可手动结案
    completed: [],                         // 终态
    cancelled: [],
};

const getCustomerDisplayName = (customer: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer.nameZh || customer.nameEn || customer.nameVi || customer.name || 'Unknown customer';

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
                message: 'Internal server error.',
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
                message: 'Internal server error.',
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
                    message: 'Order not found.',
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
                message: 'Internal server error.',
            } as ApiResponse);
        }
    }

    async createOrder(req: AuthRequest, res: Response) {
        try {
            const { customerId, items, paymentTerms = 30, notes, discountAmount = 0, contractId } = req.body;

            const customer = await prisma.customer.findUnique({
                where: { id: Number(customerId) },
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
            });
            if (!customer) {
                return res.status(400).json({
                    success: false,
                    message: 'Customer not found.',
                } as ApiResponse);
            }
            if (customer.status !== 'active') {
                return res.status(400).json({
                    success: false,
                    message: 'Only active customers can be used to create orders.',
                } as ApiResponse);
            }
            if (!canUseCustomerForBusinessWrite(req, customer)) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to create orders for this customer.',
                } as ApiResponse);
            }

            const orderNo = buildBusinessNo('ORD');
            let totalAmount = 0;
            const orderItems = items.map((item: any) => {
                const quantity = Number(item.quantity);
                const unitPrice = Number(item.unitPrice);
                const totalPrice = quantity * unitPrice;
                totalAmount += totalPrice;

                return {
                    productName: item.productName,
                    specification: item.specification || null,
                    quantity,
                    unit: item.unit || 'unit',
                    unitPrice,
                    totalPrice,
                    itemType: item.itemType || 'normal',
                    notes: item.notes || null,
                };
            });

            const finalAmount = totalAmount - Number(discountAmount);
            if (finalAmount < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Discount cannot exceed total amount.',
                } as ApiResponse);
            }

            const creditCheck = await CreditEngine.checkOrder(customerId, finalAmount);
            if (!creditCheck.allow) {
                return res.status(403).json({
                    success: false,
                    message: creditCheck.reason,
                    data: { exposure: creditCheck.exposure },
                } as ApiResponse);
            }

            const createdOrder = await withDbRetry(() => prisma.$transaction(async (tx) => {
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
                        items: { create: orderItems },
                    },
                    include: {
                        items: true,
                        customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
                    },
                });

                await tx.auditLog.create({
                    data: {
                        userId: req.user!.userId,
                        action: 'CREATE',
                        resource: 'order',
                        resourceId: newOrder.id,
                        details: `Create order: ${orderNo}, customer: ${getCustomerDisplayName(newOrder.customer)}, amount: ${finalAmount}`,
                        ipAddress: req.ip,
                        userAgent: req.get('user-agent'),
                    },
                });

                return newOrder;
            }), { label: 'createOrder' });

            const order = await OrderWorkspaceService.getOrderById(createdOrder.id, req);

            logger.info(`Order created: ${orderNo}`);
            return res.status(201).json({
                success: true,
                data: order || createdOrder,
                message: 'Order created successfully.',
            } as ApiResponse);
        } catch (error) {
            const err = error instanceof Error ? { message: error.message, stack: error.stack } : error;
            logger.error('Create order error:', err);
            return res.status(500).json({
                success: false,
                message: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : 'Internal server error.',
            } as ApiResponse);
        }
    }

    async updateOrder(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            const existing = await prisma.order.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    orderNo: true,
                    status: true,
                    createdBy: true,
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });
            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found.',
                } as ApiResponse);
            }
            if (!canUseOrderForBusinessWrite(req, existing)) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to edit this order.',
                } as ApiResponse);
            }

            if (existing.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    message: 'Only pending orders can be edited.',
                } as ApiResponse);
            }

            const updatedOrder = await prisma.order.update({
                where: { id: Number(id) },
                data: {
                    notes: updateData.notes,
                    paymentTerms: updateData.paymentTerms,
                    contractId: updateData.contractId ? Number(updateData.contractId) : undefined,
                },
            });

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'UPDATE',
                    resource: 'order',
                    resourceId: updatedOrder.id,
                    details: `Update order: ${updatedOrder.orderNo}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            const order = await OrderWorkspaceService.getOrderById(updatedOrder.id, req);

            return res.json({
                success: true,
                data: order || updatedOrder,
                message: 'Order updated successfully.',
            } as ApiResponse);
        } catch (error) {
            logger.error('Update order error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error.',
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
                    message: 'Order not found.',
                } as ApiResponse);
            }

            if (existing.status === targetStatus) {
                return res.json({
                    success: true,
                    data: existing,
                    message: 'Order status did not change.',
                } as ApiResponse);
            }

            if (!canUseOrderForBusinessWrite(req, existing)) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to change this order.',
                } as ApiResponse);
            }

            const allowedTransitions = ORDER_STATUS_TRANSITIONS[existing.status] || [];
            if (!allowedTransitions.includes(targetStatus)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid order status transition: ${existing.status} -> ${targetStatus}`,
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

            const updatedOrder = await prisma.order.update({
                where: { id: Number(id) },
                data: { status: targetStatus },
            });

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'STATUS_CHANGE',
                    resource: 'order',
                    resourceId: updatedOrder.id,
                    details: `Order status changed: ${updatedOrder.orderNo} -> ${targetStatus}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            const order = await OrderWorkspaceService.getOrderById(updatedOrder.id, req);

            return res.json({
                success: true,
                data: order || updatedOrder,
                message: 'Order status updated successfully.',
            } as ApiResponse);
        } catch (error) {
            logger.error('Update order status error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error.',
            } as ApiResponse);
        }
    }

    async recordPayment(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { amount, method, payerName, note, isProxy = false } = req.body;
            const paymentAmount = Number(amount);
            const normalizedPayerName = payerName || null;
            const normalizedNote = note || null;

            if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Payment amount must be greater than zero.',
                } as ApiResponse);
            }

            const orderMeta = await prisma.order.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    status: true,
                    paymentStatus: true,
                    paidAmount: true,
                    finalAmount: true,
                    createdBy: true,
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });

            if (!orderMeta) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found.',
                } as ApiResponse);
            }

            if (orderMeta.status === 'cancelled') {
                return res.status(400).json({
                    success: false,
                    message: 'Cancelled orders cannot accept payments.',
                } as ApiResponse);
            }
            if (!canUseOrderForBusinessWrite(req, orderMeta)) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to record payments for this order.',
                } as ApiResponse);
            }

            if (Number(orderMeta.paidAmount) >= Number(orderMeta.finalAmount) || orderMeta.paymentStatus === 'paid') {
                return res.status(400).json({
                    success: false,
                    message: 'Order is already fully paid.',
                } as ApiResponse);
            }

            const outstanding = Math.max(0, Number(orderMeta.finalAmount) - Number(orderMeta.paidAmount));
            if (paymentAmount - outstanding > 0.01) {
                return res.status(400).json({
                    success: false,
                    message: 'Payment amount exceeds outstanding balance.',
                } as ApiResponse);
            }

            const duplicateWindowStart = new Date(Date.now() - 15_000);
            const transactionResult = await withDbRetry(() => prisma.$transaction(async (tx) => {
                // Serialize same-order payment submissions before checking duplicates.
                // Without this row touch, two fast clicks can both read "no pending duplicate"
                // and create two identical payment records.
                const liveOrder = await tx.order.update({
                    where: { id: Number(id) },
                    data: { updatedAt: new Date() },
                    select: {
                        id: true,
                        paymentStatus: true,
                        paidAmount: true,
                        finalAmount: true,
                    },
                });

                if (Number(liveOrder.paidAmount) >= Number(liveOrder.finalAmount) || liveOrder.paymentStatus === 'paid') {
                    return { duplicatePaymentId: null, alreadyPaid: true };
                }

                const liveOutstanding = Math.max(0, Number(liveOrder.finalAmount) - Number(liveOrder.paidAmount));
                if (paymentAmount - liveOutstanding > 0.01) {
                    return { duplicatePaymentId: null, exceedsOutstanding: true };
                }

                const orderWithContract = await tx.order.findUnique({
                    where: { id: Number(id) },
                    select: {
                        id: true,
                        contract: {
                            select: {
                                milestones: {
                                    where: { status: 'pending' },
                                    orderBy: { id: 'asc' },
                                    take: 1,
                                    select: { id: true },
                                },
                            },
                        },
                    },
                });

                const milestoneId = orderWithContract?.contract?.milestones?.[0]?.id ?? null;
                const duplicatePendingPayment = await tx.paymentRecord.findFirst({
                    where: {
                        orderId: Number(id),
                        amount: paymentAmount,
                        method,
                        payerName: normalizedPayerName,
                        note: normalizedNote,
                        isProxy: Boolean(isProxy),
                        status: 'pending',
                        createdAt: { gte: duplicateWindowStart },
                    },
                    select: { id: true },
                });

                if (duplicatePendingPayment) {
                    return { duplicatePaymentId: duplicatePendingPayment.id };
                }

                await tx.paymentRecord.create({
                    data: {
                        orderId: Number(id),
                        amount: paymentAmount,
                        method,
                        payerName: normalizedPayerName,
                        note: normalizedNote,
                        isProxy,
                        milestoneId,
                        status: 'pending',
                    },
                });

                await tx.auditLog.create({
                    data: {
                        userId: req.user!.userId,
                        action: 'PAYMENT_SUBMITTED',
                        resource: 'order',
                        resourceId: Number(id),
                        details: JSON.stringify({ amount: paymentAmount, method, milestoneId, status: 'pending' }),
                        ipAddress: req.ip,
                        userAgent: req.get('user-agent'),
                    },
                });

                return { duplicatePaymentId: null };
            }), { label: 'recordPayment' });

            if (transactionResult.alreadyPaid) {
                return res.status(400).json({
                    success: false,
                    message: 'Order is already fully paid.',
                } as ApiResponse);
            }

            if (transactionResult.exceedsOutstanding) {
                return res.status(400).json({
                    success: false,
                    message: 'Payment amount exceeds outstanding balance.',
                } as ApiResponse);
            }

            if (transactionResult.duplicatePaymentId) {
                const order = await OrderWorkspaceService.getOrderById(Number(id), req);
                return res.status(409).json({
                    success: false,
                    message: 'Duplicate payment submission detected. Please refresh payment records before submitting again.',
                    data: order,
                } as ApiResponse);
            }

            const order = await OrderWorkspaceService.getOrderById(Number(id), req);
            logger.info(`Payment submitted: orderId=${id}, amount=${amount}`);

            return res.json({
                success: true,
                message: 'Payment recorded successfully.',
                data: order,
            } as ApiResponse);
        } catch (error) {
            logger.error('Record payment error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error.',
            } as ApiResponse);
        }
    }

    async verifyPayment(req: AuthRequest, res: Response) {
        try {
            const { id, paymentId } = req.params;
            const payment = await prisma.paymentRecord.findUnique({
                where: { id: Number(paymentId) },
                select: { id: true, orderId: true },
            });

            if (!payment || payment.orderId !== Number(id)) {
                return res.status(404).json({
                    success: false,
                    message: 'Payment record not found.',
                } as ApiResponse);
            }

            // H5修复：职责分离 — 订单创建者不能验证自己订单的付款
            const orderForSoD = await prisma.order.findUnique({
                where: { id: Number(id) },
                select: {
                    createdBy: true,
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });
            if (orderForSoD && !canUseOrderForBusinessWrite(req, orderForSoD)) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to verify payments for this order.',
                } as ApiResponse);
            }
            if (orderForSoD && orderForSoD.createdBy === req.user!.userId) {
                return res.status(403).json({
                    success: false,
                    message: '职责分离：订单创建者不能验证自己订单的付款记录。',
                } as ApiResponse);
            }

            const result = await CollectionStateService.verifyPaymentRecord(payment.id, req.user!.userId);
            const order = await OrderWorkspaceService.getOrderById(Number(id), req);

            return res.json({
                success: true,
                message: 'Payment verified successfully.',
                data: order || result,
            } as ApiResponse);
        } catch (error) {
            logger.error('Verify payment error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error.',
            } as ApiResponse);
        }
    }

    async importOrders(req: AuthRequest, res: Response) {
        try {
            const { orders } = req.body;
            const result = await OrderWorkspaceService.importOrders(orders, req.user!.userId);

            if ('error' in result) {
                return res.status(400).json({
                    success: false,
                    message: result.error,
                } as ApiResponse);
            }

            return res.json({
                success: true,
                data: result.result,
                message: `Import completed: success ${result.result.success}, failed ${result.result.failed}`,
            } as ApiResponse);
        } catch (error) {
            logger.error('Failed to import orders:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error.',
            } as ApiResponse);
        }
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
            return res.status(500).json({ success: false, message: 'Internal server error.' });
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
                return res.status(404).json({ success: false, message: 'Order not found.' });
            }
            if (!canUseOrderForBusinessWrite(req, order)) {
                return res.status(403).json({ success: false, message: 'You do not have permission to complete this order.' });
            }

            // H2修复：业务校验 — 必须全款且物流已发或已签收
            if (!['shipped', 'delivered'].includes(order.status) || order.paymentStatus !== 'paid') {
                return res.status(400).json({
                    success: false,
                    message: 'Only shipped/delivered and fully paid orders can be completed.',
                });
            }

            const updatedOrder = await prisma.order.update({
                where: { id: Number(id) },
                data: { status: 'completed' }, // H2修复：手动结案使用独立的 completed 状态
            });

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'COMPLETE',
                    resource: 'order',
                    resourceId: Number(id),
                    details: '订单手动结案成功',
                }
            });

            const orderDetail = await OrderWorkspaceService.getOrderById(updatedOrder.id, req);

            return res.json({
                success: true,
                message: 'Order completed successfully.',
                data: orderDetail || updatedOrder,
            });
        } catch (error) {
            logger.error('订单结案失败:', error);
            return res.status(500).json({ success: false, message: 'Internal server error.' });
        }
    }

    async exportOrders(req: AuthRequest, res: Response) {
        try {
            const { workbook, orders } = await OrderWorkspaceService.exportOrders(
                {
                    status: req.query.status as string | undefined,
                    startDate: req.query.startDate as string | undefined,
                    endDate: req.query.endDate as string | undefined,
                    lang: req.query.lang as string | undefined,
                },
                req,
            );

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=orders_${new Date().toISOString().split('T')[0]}.xlsx`);

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'EXPORT',
                    resource: 'order',
                    details: `Exported orders: ${orders.length}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            logger.error('Failed to export orders:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error.',
            } as ApiResponse);
        }
    }
}

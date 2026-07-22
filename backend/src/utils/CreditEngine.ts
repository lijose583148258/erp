import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../utils/logger';

type CreditDataClient = Pick<Prisma.TransactionClient, 'customer' | 'order'>;

export type CreditStatus = 'healthy' | 'warning' | 'critical' | 'overlimit';

export interface CreditExposure {
    customerId: number;
    creditLimit: number;
    totalExposure: number;
    usageRate: number;
    status: CreditStatus;
}

export class CreditEngine {
    /**
     * 计算客户当前的信用风险敞口
     * 敞口 = 所有未结清(pending/processing/shipped)订单的总金额 - 部分付款金额
     */
    static async getExposure(customerId: number, db: CreditDataClient = prisma, excludeOrderId?: number): Promise<CreditExposure> {
        const customer = await db.customer.findUnique({
            where: { id: customerId },
            select: { creditLimit: true }
        });

        // H1修复：显式处理 null creditLimit（null = 未设置授信，0 = 授信为零）
        const limit = customer?.creditLimit != null ? Number(customer.creditLimit) : 0;

        // 获取所有未完全结清的订单 (排除已完成/已取消)
        const activeOrders = await db.order.findMany({
            where: {
                customerId,
                ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
                status: { notIn: ['completed', 'cancelled'] },
                paymentStatus: { not: 'paid' }
            },
            select: {
                finalAmount: true,
                paidAmount: true
            }
        });

        // 计算敞口总量 (未付款总额)
        const totalExposure = activeOrders.reduce((sum, order) => {
            return sum + (Number(order.finalAmount) - Number(order.paidAmount));
        }, 0);

        const usageRate = limit > 0 ? (totalExposure / limit) : (totalExposure > 0 ? 999 : 0);

        let status: CreditStatus = 'healthy';
        if (usageRate >= 1) status = 'overlimit';
        else if (usageRate >= 0.9) status = 'critical';
        else if (usageRate >= 0.8) status = 'warning';

        return {
            customerId,
            creditLimit: limit,
            totalExposure,
            usageRate,
            status
        };
    }


    /**
     * 判定是否允许新订单
     * 信用额度语义：
     *   null  = 未设定额度 → 要求管理员先设定，拦截新订单
     *   0     = 明确禁止赊账 → 拒绝所有新订单
     *   > 0   = 正常信用额度检查
     */
    static async checkOrder(customerId: number, newOrderAmount: number, db: CreditDataClient = prisma, excludeOrderId?: number) {
        const customer = await db.customer.findUnique({
            where: { id: customerId },
            select: {
                creditLimit: true,
                creditHold: true,
                creditHoldReason: true,
                collectionsStatus: true,
                dunningLevel: true,
            },
        });

        if (customer?.creditHold || ['hold', 'disputed', 'legal'].includes(customer?.collectionsStatus || '') || (customer?.dunningLevel || 0) >= 3) {
            return {
                allow: false,
                reason: customer?.creditHoldReason || '客户处于追款拦截状态，暂不能新增订单',
                exposure: {
                    customerId,
                    creditLimit: customer?.creditLimit ?? 0,
                    totalExposure: 0,
                    usageRate: 1,
                    status: 'overlimit' as CreditStatus,
                },
            };
        }

        // 修复：区分 null（未设额度）和 0（禁止赊账）
        if (customer?.creditLimit === null || customer?.creditLimit === undefined) {
            return {
                allow: false,
                reason: '该客户尚未设定信用额度，请联系管理员先设定客户授信额度。',
                exposure: {
                    customerId,
                    creditLimit: 0,
                    totalExposure: 0,
                    usageRate: 0,
                    status: 'warning' as CreditStatus,
                },
            };
        }

        if (Number(customer.creditLimit) === 0 && newOrderAmount > 0) {
            return {
                allow: false,
                reason: '客户信用额度为零（禁止赊账），不能新增订单。',
                exposure: {
                    customerId,
                    creditLimit: 0,
                    totalExposure: 0,
                    usageRate: 999,
                    status: 'overlimit' as CreditStatus,
                },
            };
        }

        const exposure = await this.getExposure(customerId, db, excludeOrderId);

        let projectedUsage = 0;
        if (exposure.creditLimit > 0) {
            projectedUsage = (exposure.totalExposure + newOrderAmount) / exposure.creditLimit;
        } else {
            // 额度 > 0 但 getExposure 返回 0 的边界情况（理论上不会到达）
            projectedUsage = (exposure.totalExposure + newOrderAmount) > 0 ? 1.01 : 0;
        }

        if (projectedUsage > 1) {
            return {
                allow: false,
                reason: `信用额度不足。当前敞口 ${exposure.totalExposure.toFixed(2)}，此订单将超出客户授信额度 (${exposure.creditLimit.toFixed(2)})。`,
                exposure
            };
        }

        return { allow: true, exposure };
    }

    static async checkShipment(orderId: number) {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                orderNo: true,
                shipmentHold: true,
                shipmentHoldReason: true,
                customer: {
                    select: {
                        id: true,
                        name: true,
                        creditHold: true,
                        shipmentHold: true,
                        creditHoldReason: true,
                        shipmentHoldReason: true,
                        collectionsStatus: true,
                        dunningLevel: true,
                    },
                },
            },
        });

        if (!order) {
            return {
                allow: false,
                reason: '订单不存在',
            };
        }

        const blocked =
            order.shipmentHold ||
            order.customer.creditHold ||
            order.customer.shipmentHold ||
            ['hold', 'disputed', 'legal'].includes(order.customer.collectionsStatus || '') ||
            (order.customer.dunningLevel || 0) >= 4;

        if (blocked) {
            return {
                allow: false,
                reason:
                    order.shipmentHoldReason ||
                    order.customer.shipmentHoldReason ||
                    order.customer.creditHoldReason ||
                    '客户处于拦截状态，暂不能发货',
            };
        }

        return { allow: true };
    }

}

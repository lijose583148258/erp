import { OrderStatus, type SalesOrder } from '../../types';

interface SalesOrderUser {
    id: string | number;
    role: string;
}

export const canAuditCommissionRole = (role: string) => ['admin', 'manager'].includes(role);

export const canRecordPaymentRole = (role: string) => ['admin', 'finance', 'manager', 'sales'].includes(role);

export const canVerifyPaymentRole = (role: string) => ['admin', 'finance'].includes(role);

export const canCreateOrderRole = (role: string) => ['admin', 'manager', 'sales'].includes(role);

export const canEditSalesOrderForUser = (user: SalesOrderUser, order: SalesOrder) => {
    if (['admin', 'manager'].includes(user.role)) return true;
    if (user.role === 'sales' && order.salespersonId === user.id && order.status === OrderStatus.PENDING) return true;
    return false;
};

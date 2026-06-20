import { can } from '../../app/permissions';
import { OrderStatus, type CurrentUser, type SalesOrder } from '../../types';

type SalesOrderUser = Pick<CurrentUser, 'id' | 'role' | 'permissions'>;

export const canAuditCommissionForUser = (user: SalesOrderUser) => can(user as CurrentUser, 'orders.complete');

export const canRecordPaymentForUser = (user: SalesOrderUser) => can(user as CurrentUser, 'orders.payment.record');

export const canVerifyPaymentForUser = (user: SalesOrderUser) => can(user as CurrentUser, 'orders.payment.verify');

export const canCreateOrderForUser = (user: SalesOrderUser) => can(user as CurrentUser, 'orders.create');

export const canEditSalesOrderForUser = (user: SalesOrderUser, order: SalesOrder) => {
    if (!can(user as CurrentUser, 'orders.update')) return false;
    if (user.role !== 'sales') return true;
    if (String(order.salespersonId) === String(user.id) && order.status === OrderStatus.PENDING) return true;
    return false;
};

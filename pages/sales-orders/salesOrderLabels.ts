import type { Customer, Language, SalesOrder } from '../../types';
import { getCustomerDisplayName } from '../../utils/customerName';

export const getSalesOrderCustomerLabel = (
    customer?: Pick<Customer, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'displayName'> | null,
    language?: Language,
) => {
    if (!customer) return '';
    return getCustomerDisplayName(customer, language);
};

export const getSalesOrderCustomerLabelFromOrder = (
    order?: Pick<SalesOrder, 'customerName' | 'customerNameZh' | 'customerNameEn' | 'customerNameVi' | 'customerDisplayName'> | null,
) => {
    if (!order) return '';
    return order.customerDisplayName || order.customerNameZh || order.customerNameEn || order.customerNameVi || order.customerName || '';
};

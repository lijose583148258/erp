import type { Dispatch, SetStateAction } from 'react';
import { orderService } from '../../services/order.service';
import type { CurrentUser, PaymentRecord, SalesOrder } from '../../types';
import { getOutstandingAmount, type PaymentForm } from './salesOrderFormHelpers';
import { getSalesOrderCustomerLabelFromOrder } from './salesOrderLabels';
import type { NotifyFn } from './useSalesOrderWorkspaceData';

type UseSalesOrderPaymentsOptions = {
    selectedOrder: SalesOrder | null;
    paymentForm: PaymentForm;
    currentUser: CurrentUser;
    canVerifyPayment: boolean;
    formatPrice: (value: number) => string;
    notify: NotifyFn;
    setSelectedOrder: Dispatch<SetStateAction<SalesOrder | null>>;
    setPaymentForm: Dispatch<SetStateAction<PaymentForm>>;
    setIsPaymentOpen: Dispatch<SetStateAction<boolean>>;
    hydrateOrderDetail: (order: SalesOrder) => Promise<SalesOrder>;
    upsertOrder: (order: SalesOrder) => void;
};

export const useSalesOrderPayments = ({
    selectedOrder,
    paymentForm,
    currentUser,
    canVerifyPayment,
    formatPrice,
    notify,
    setSelectedOrder,
    setPaymentForm,
    setIsPaymentOpen,
    hydrateOrderDetail,
    upsertOrder,
}: UseSalesOrderPaymentsOptions) => {
    const openPaymentModal = async (order: SalesOrder) => {
        const detailedOrder = await hydrateOrderDetail(order);
        setSelectedOrder(detailedOrder);
        setPaymentForm({
            amount: getOutstandingAmount(detailedOrder),
            date: new Date().toISOString().split('T')[0],
            method: 'bank_transfer',
            isProxy: false,
            payerName: getSalesOrderCustomerLabelFromOrder(detailedOrder),
            note: '',
        });
        setIsPaymentOpen(true);
    };

    const handleVerifyPayment = async (paymentId: string) => {
        if (!selectedOrder) return;
        try {
            const updatedOrder = await orderService.verifyPayment(selectedOrder.id, paymentId);
            upsertOrder(updatedOrder);
            setSelectedOrder(updatedOrder);
            notify('success', '收款已核验并同步到账本。');
        } catch {
            notify('error', '核验失败。');
        }
    };

    const handleRecordPayment = async () => {
        if (!selectedOrder) return;
        if (paymentForm.amount <= 0) {
            notify('error', '金额无效。');
            return;
        }

        const outstanding = getOutstandingAmount(selectedOrder);
        if (paymentForm.amount > outstanding + 0.009) {
            notify('error', `收款金额不能超过有效未收金额：${formatPrice(outstanding)}。`);
            return;
        }

        const payment: PaymentRecord = {
            id: 'PAY-' + Date.now(),
            date: paymentForm.date,
            amount: Number(paymentForm.amount),
            method: paymentForm.method,
            isProxy: paymentForm.isProxy,
            payerName: paymentForm.isProxy ? paymentForm.payerName : getSalesOrderCustomerLabelFromOrder(selectedOrder),
            note: paymentForm.note,
            recordedBy: currentUser.name,
            status: 'pending',
            createdByRole: currentUser.role,
        };

        try {
            const updatedOrder = await orderService.recordPayment(selectedOrder.id, payment);
            upsertOrder(updatedOrder);
            setSelectedOrder(updatedOrder);
            setIsPaymentOpen(false);
            if (canVerifyPayment) {
                notify('success', '收款已登记，已进入待核验队列，请回读订单余额和回款记录。');
            } else {
                notify('success', '收款已提交审核。');
            }
        } catch {
            notify('error', '收款登记失败。');
        }
    };

    return {
        openPaymentModal,
        handleVerifyPayment,
        handleRecordPayment,
    };
};

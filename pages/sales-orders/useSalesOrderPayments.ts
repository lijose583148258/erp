import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { orderService } from '../../src/services/order.service';
import type { CurrentUser, PaymentRecord, SalesOrder } from '../../types';
import { getOutstandingAmount, type PaymentForm } from './salesOrderFormHelpers';
import { getSalesOrderCustomerLabelFromOrder } from './salesOrderLabels';
import { invalidateSalesOrderWorkspaceState, type NotifyFn } from './useSalesOrderWorkspaceData';
import { clearPaymentIntent, isDefinitivePaymentRejection, preparePaymentIntent, readPaymentIntent } from './paymentSubmissionIntent';
import type { ApiClientError } from '../../utils/api';

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
    const inFlight = useRef(false);
    const [isRecordingPayment, setIsRecordingPayment] = useState(false);
    const [hasUnconfirmedPayment, setHasUnconfirmedPayment] = useState(false);
    const openPaymentModal = async (order: SalesOrder) => {
        if (inFlight.current) return;
        const detailedOrder = await hydrateOrderDetail(order);
        let pending;
        try { pending = readPaymentIntent(window.localStorage, String(currentUser.id), String(detailedOrder.id)); }
        catch (error) { notify('error', (error as Error).message || '无法读取原回款请求身份，未开启新登记。'); return; }
        setSelectedOrder(detailedOrder);
        setHasUnconfirmedPayment(Boolean(pending));
        setPaymentForm(pending?.facts || {
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
            invalidateSalesOrderWorkspaceState();
            upsertOrder(updatedOrder);
            setSelectedOrder(updatedOrder);
            notify('success', '收款已核验并同步到账本。');
        } catch {
            notify('error', '核验失败。');
        }
    };

    const handleRecordPayment = async () => {
        if (!selectedOrder || inFlight.current) return;
        if (paymentForm.amount <= 0) {
            notify('error', '金额无效。');
            return;
        }

        const outstanding = getOutstandingAmount(selectedOrder);
        if (!hasUnconfirmedPayment && paymentForm.amount > outstanding + 0.009) {
            notify('error', `收款金额不能超过有效未收金额：${formatPrice(outstanding)}。`);
            return;
        }

        inFlight.current = true;
        setIsRecordingPayment(true);
        let intent;
        try {
            intent = preparePaymentIntent(window.localStorage, String(currentUser.id), String(selectedOrder.id), {
                ...paymentForm, amount: Number(paymentForm.amount),
                payerName: hasUnconfirmedPayment || paymentForm.isProxy ? paymentForm.payerName : getSalesOrderCustomerLabelFromOrder(selectedOrder),
            }, () => crypto.randomUUID());
            setHasUnconfirmedPayment(true);
        } catch (error) {
            inFlight.current = false; setIsRecordingPayment(false);
            notify('error', (error as Error).message || '无法保存回款请求身份，未发送登记。'); return;
        }
        const payment: PaymentRecord = {
            id: 'PAY-' + Date.now(),
            submissionKey: intent.key,
            ...intent.facts,
            recordedBy: currentUser.name,
            status: 'pending',
            createdByRole: currentUser.role,
        };

        try {
            const updatedOrder = await orderService.recordPayment(selectedOrder.id, payment);
            clearPaymentIntent(window.localStorage, String(currentUser.id), String(selectedOrder.id), intent.key);
            setHasUnconfirmedPayment(false);
            invalidateSalesOrderWorkspaceState();
            upsertOrder(updatedOrder);
            setSelectedOrder(updatedOrder);
            setIsPaymentOpen(false);
            if (canVerifyPayment) {
                notify('success', '收款已登记，已进入待核验队列，请回读订单余额和回款记录。');
            } else {
                notify('success', '收款已提交审核。');
            }
        } catch (error) {
            if (isDefinitivePaymentRejection((error as ApiClientError).errorCode)) {
                try { clearPaymentIntent(window.localStorage, String(currentUser.id), String(selectedOrder.id), intent.key); setHasUnconfirmedPayment(false); }
                catch { /* Do not discard the original identity on storage failure. */ }
                notify('error', (error as Error).message);
            } else {
                notify('error', '提交结果未确认。原请求身份已保留；请重试确认，不会另建一笔回款。');
            }
        } finally {
            inFlight.current = false; setIsRecordingPayment(false);
        }
    };

    return {
        openPaymentModal,
        handleVerifyPayment,
        handleRecordPayment,
        isRecordingPayment,
        hasUnconfirmedPayment,
    };
};

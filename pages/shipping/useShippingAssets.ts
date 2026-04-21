import { useState } from 'react';
import type { AssetTransaction, AssetType, Customer, Language } from '../../types';
import { assetService } from '../../services/asset.service';
import { getCustomerDisplayName } from '../../utils/customerName';
import { reportClientIssue } from '../../utils/clientIssue';

type Notify = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

type ShippingAssetForm = {
    customerId: string;
    type: AssetType;
    quantity: number;
    action: 'outbound' | 'return';
    date: string;
    note: string;
};

type UseShippingAssetsOptions = {
    t: Record<string, string>;
    notify: Notify;
    language: Language;
    customers: Customer[];
    loadData: (signal?: AbortSignal) => Promise<void>;
};

const createDefaultAssetForm = (): ShippingAssetForm => ({
    customerId: '',
    type: 'Wooden Pallet',
    quantity: 1,
    action: 'outbound',
    date: new Date().toISOString().split('T')[0],
    note: ''
});

export const useShippingAssets = ({ t, notify, language, customers, loadData }: UseShippingAssetsOptions) => {
    const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
    const [assetForm, setAssetForm] = useState<ShippingAssetForm>(createDefaultAssetForm);

    const getCustomerLabel = (customer?: Customer | null) => {
        if (!customer) return 'Unknown';
        return customer.displayName || getCustomerDisplayName(customer, language);
    };

    const handleAssetSubmit = async () => {
        if (!assetForm.customerId || assetForm.quantity <= 0) {
            notify('error', t.fillValidForm || 'Please fill a valid record');
            return;
        }

        const customer = customers.find(c => c.id === assetForm.customerId);
        const newTx: AssetTransaction = {
            id: '',
            date: assetForm.date,
            customerId: assetForm.customerId,
            customerName: getCustomerLabel(customer),
            customerNameZh: customer?.nameZh,
            customerNameEn: customer?.nameEn,
            customerNameVi: customer?.nameVi,
            customerDisplayName: getCustomerLabel(customer),
            type: assetForm.type,
            quantity: assetForm.quantity,
            action: assetForm.action,
            note: assetForm.note
        };

        try {
            await assetService.create(newTx);
            setIsAssetModalOpen(false);
            notify('success', t.assetSuccess || 'Asset flow recorded');
            loadData();
        } catch (err) {
            reportClientIssue('shipping.asset-submit', err);
            notify('error', t.saveFail || 'Failed to save record');
        }
    };

    return {
        isAssetModalOpen,
        assetForm,
        setAssetForm,
        setIsAssetModalOpen,
        handleAssetSubmit,
    };
};

export type { ShippingAssetForm };

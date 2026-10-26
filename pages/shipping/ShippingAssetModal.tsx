import React from 'react';
import { X } from 'lucide-react';
import { AssetType } from '../../types';
import { getCustomerDisplayName } from '../../utils/customerName';

type CustomerOption = {
    id: string;
    name: string;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
    displayName?: string | null;
};

type Props = {
    t: Record<string, string>;
    isOpen: boolean;
    customers: CustomerOption[];
    assetForm: { customerId: string; type: AssetType; quantity: number; action: 'outbound' | 'return'; date: string; note: string };
    setAssetForm: React.Dispatch<React.SetStateAction<any>>;
    onClose: () => void;
    onSubmit: () => void;
};

const ShippingAssetModal: React.FC<Props> = ({ t, isOpen, customers, assetForm, setAssetForm, onClose, onSubmit }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-md">
            <div className="w-full max-w-[400px] rounded-[40px] border border-slate-100 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950 sm:p-8">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-black uppercase italic tracking-tighter text-xl text-slate-900 dark:text-white">{t.recordMove || '资产录入'}</h3>
                    <button type="button" onClick={onClose} aria-label="关闭资产录入弹窗" className="flex min-h-10 min-w-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button>
                </div>
                <div className="space-y-4">
                    <select className="w-full p-4 bg-slate-100 dark:bg-slate-900 rounded-2xl font-bold border-none outline-none appearance-none" value={assetForm.customerId} onChange={(e) => setAssetForm({ ...assetForm, customerId: e.target.value })}>
                        <option value="">{t.selectCustomer || '选择合作客户'}</option>
                        {customers.map(c => (
                            <option key={c.id} value={c.id}>
                                {getCustomerDisplayName(c, 'zh') || c.displayName || c.name}
                            </option>
                        ))}
                    </select>
                    <div className="grid grid-cols-2 gap-3">
                        <select className="p-4 bg-slate-100 dark:bg-slate-900 rounded-2xl font-bold border-none" value={assetForm.type} onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value as AssetType })}>
                            <option value="Wooden Pallet">Pallet</option>
                            <option value="IBC Tank">IBC Tank</option>
                            <option value="Iron Drum 200L">Drum</option>
                        </select>
                        <input type="number" className="p-4 bg-slate-100 dark:bg-slate-900 rounded-2xl font-black text-center" value={assetForm.quantity} onChange={(e) => setAssetForm({ ...assetForm, quantity: Number(e.target.value) })} />
                    </div>
 <button onClick={onSubmit} className="w-full py-5 bg-blue-600 text-white rounded-[24px] font-black shadow-xl transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none text-xs uppercase tracking-[0.2em] mt-2">
                        {t.confirmRecord || '确认并提交'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShippingAssetModal;

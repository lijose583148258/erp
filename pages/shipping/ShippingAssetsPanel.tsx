import React from 'react';
import { Recycle } from 'lucide-react';
import { AssetSummary } from '../../types';

type Props = {
    t: Record<string, string>;
    assetSummaries: AssetSummary[];
    onOpenRecordMove: () => void;
    onQuickReturn: (customerId: string) => void;
};

const ShippingAssetsPanel: React.FC<Props> = ({ t, assetSummaries, onOpenRecordMove, onQuickReturn }) => {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between p-6 bg-indigo-50 dark:bg-indigo-900/20 rounded-[32px] border border-indigo-100 dark:border-indigo-800">
                <div className="flex items-center gap-4">
                    <div className="p-4 bg-indigo-500 text-white rounded-2xl shadow-lg">
                        <Recycle size={32} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-indigo-900 dark:text-indigo-100 uppercase italic">{t.assetHub || 'Asset Flow Center'}</h2>
                        <p className="text-sm font-medium text-indigo-600/70">{t.assetHubSub || 'Tracking IBC, Pallets & Drums'}</p>
                    </div>
                </div>
                <button
                    onClick={onOpenRecordMove}
                    className="flex items-center px-8 py-4 bg-indigo-600 text-white rounded-[24px] font-black shadow-xl hover:scale-105 active:scale-95 transition-all text-xs uppercase tracking-widest"
                >
                    {t.recordMove || 'Record Move'}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {assetSummaries.map((summary) => (
                    <div key={summary.customerId} className="bg-white dark:bg-slate-900 p-6 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm relative group overflow-hidden">
                        <h3 className="font-black text-slate-800 dark:text-white text-lg">{summary.customerDisplayName || summary.customerName}</h3>
                        <div className="mt-4 space-y-2">
                            {Object.entries(summary.balances).map(([type, qty]) => (
                                qty !== 0 && (
                                    <div key={type} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                                        <span className="text-xs font-bold text-slate-500">{type}</span>
                                        <span className={`text-sm font-black ${Number(qty) > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                            {Number(qty) > 0 ? `-${qty}` : `+${Math.abs(Number(qty))}`}
                                        </span>
                                    </div>
                                )
                            ))}
                        </div>
                        <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 backdrop-blur-sm">
                            <button
                                onClick={() => onQuickReturn(summary.customerId)}
                                className="px-6 py-3 bg-emerald-500 text-white rounded-2xl font-black text-xs uppercase shadow-xl hover:scale-110 transition-transform"
                            >
                                {t.receiveBack || 'Return'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ShippingAssetsPanel;

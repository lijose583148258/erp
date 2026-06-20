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
            <div className="flex flex-col gap-4 rounded-[32px] border border-indigo-100 bg-indigo-50 p-6 dark:border-indigo-800 dark:bg-indigo-900/20 sm:flex-row sm:items-center sm:justify-between">
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
                    type="button"
                    onClick={onOpenRecordMove}
                    className="flex min-h-11 items-center justify-center rounded-[24px] bg-indigo-600 px-8 py-4 text-xs font-black uppercase tracking-widest text-white shadow-xl transition-all hover:scale-105 active:scale-95"
                >
                    {t.recordMove || 'Record Move'}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {assetSummaries.map((summary) => (
                    <div key={summary.customerId} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                        <h3 className="truncate text-lg font-black text-slate-800 dark:text-white" title={summary.customerDisplayName || summary.customerName}>{summary.customerDisplayName || summary.customerName}</h3>
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
                        <button
                            type="button"
                            onClick={() => onQuickReturn(summary.customerId)}
                            className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                        >
                            {t.receiveBack || 'Return'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ShippingAssetsPanel;

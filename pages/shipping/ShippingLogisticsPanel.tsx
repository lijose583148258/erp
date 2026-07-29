import React from 'react';
import { AlertCircle, CheckCircle, MapPin, ThermometerSnowflake, Truck, X } from 'lucide-react';
import { renderSparkline } from './ShippingColumns';

type Props = {
    t: Record<string, string>;
    shipments: any[];
    laneStats: Array<{ route: string; total: number; coldChain: number; avgTemp: string }>;
    coldChainSeries: Array<{ shipment: any; series: number[]; max: number; min: number }>;
    onGenerateAiInsights: () => void;
    isAiPanelOpen: boolean;
    aiInsights: Array<{ title: string; desc: string; level: 'low' | 'medium' | 'high' }>;
    onCloseAiPanel: () => void;
};

const ShippingLogisticsPanel: React.FC<Props> = ({
    t,
    shipments,
    laneStats,
    coldChainSeries,
    onGenerateAiInsights,
    isAiPanelOpen,
    aiInsights,
    onCloseAiPanel,
}) => {
    const stats = [
        { label: t.dispatchPending || '待处理', value: shipments.filter((item) => item.status === 'pending').length, icon: Truck, color: 'text-blue-500' },
        { label: t.activeTransit || '在途', value: shipments.filter((item) => item.status === 'in_transit').length, icon: MapPin, color: 'text-amber-500' },
        { label: t.deliveredToday || '已送达', value: shipments.filter((item) => item.status === 'delivered').length, icon: CheckCircle, color: 'text-emerald-500' },
        { label: t.exceptions || t.exception || '异常', value: shipments.filter((item) => item.status === 'exception').length, icon: AlertCircle, color: 'text-rose-500' },
    ];

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={onGenerateAiInsights}
                    className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-2xl font-black text-sm shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all"
                >
                    <Truck size={18} className="mr-2" />
                    {t.arrangeDispatch || '发运驾驶舱'}
                </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {stats.map((stat) => (
                    <div key={stat.label} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between dark:bg-slate-900 dark:border-slate-800">
                        <p className="text-xs text-slate-400 font-black uppercase tracking-widest mb-4">{stat.label}</p>
                        <div className="flex items-center justify-between">
                            <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{stat.value}</span>
                            <div className={`p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 ${stat.color}`}>
                                <stat.icon size={20} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {laneStats.map((lane) => (
                    <div key={lane.route} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-slate-400 font-black uppercase tracking-widest mb-2">{t.route || '运输线路'}</p>
                                <p className="text-lg font-black text-slate-800 dark:text-white">{lane.route}</p>
                            </div>
                            <MapPin size={18} className="text-blue-500" />
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl py-3"><p className="text-xs text-slate-400 font-black uppercase">{t.records || '记录'}</p><p className="text-lg font-black text-slate-800 dark:text-white">{lane.total}</p></div>
                            <div className="bg-cyan-50 dark:bg-cyan-900/20 rounded-2xl py-3"><p className="text-xs text-cyan-600 font-black uppercase">{t.coldChain || '冷链'}</p><p className="text-lg font-black text-cyan-700 dark:text-cyan-300">{lane.coldChain}</p></div>
                            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl py-3"><p className="text-xs text-slate-400 font-black uppercase">{t.temperature || '温度'}</p><p className="text-lg font-black text-slate-800 dark:text-white">{lane.avgTemp}°C</p></div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-widest">{t.coldChainMonitor || '冷链监控'}</h2>
                        <p className="text-xs text-slate-500 font-bold mt-2">{t.temperatureCurve || '温度曲线与异常快照'}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-black text-cyan-600 bg-cyan-50 dark:bg-cyan-900/20 px-3 py-2 rounded-full"><ThermometerSnowflake size={14} />{coldChainSeries.length} {t.records || '记录'}</div>
                    <button type="button" onClick={onGenerateAiInsights} className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100">AI预警面板</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {coldChainSeries.map(({ shipment, series, max, min }) => {
                        const latest = series[series.length - 1];
                        const safe = latest >= 2 && latest <= 8;
                        return (
                            <div key={shipment.id} className="border border-slate-100 dark:border-slate-800 rounded-2xl p-4 bg-slate-50/60 dark:bg-slate-900/40">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <p className="text-xs font-black text-slate-400 uppercase">{shipment.route || t.route || '运输线路'}</p>
                                        <p className="text-sm font-bold text-slate-800 dark:text-white">#{shipment.id}</p>
                                    </div>
                                    <span className={`px-2 py-1 rounded-full text-[11px] font-black uppercase ${safe ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{safe ? (t.tempSafe || '温控正常') : (t.tempAlert || '温控预警')}</span>
                                </div>
                                <div className="flex items-center justify-between">{renderSparkline(series)}<div className="text-right"><p className="text-2xl font-black text-cyan-600">{latest}°C</p><p className="text-xs text-slate-400 font-bold uppercase">{t.temperatureRange || '范围'}: {min}~{max}°C</p></div></div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {isAiPanelOpen && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-[520px] rounded-[32px] border border-slate-100 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                        <div className="mb-4 flex items-center justify-between gap-4"><h3 className="min-w-0 text-lg font-black">AI 仓储与物流预警建议</h3><button type="button" onClick={onCloseAiPanel} aria-label="关闭 AI 预警面板" className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><X size={16} /></button></div>
                        <div className="space-y-3">{aiInsights.map((insight, idx) => (<div key={idx} className={`p-4 rounded-2xl border ${insight.level === 'high' ? 'border-rose-200 bg-rose-50' : insight.level === 'medium' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="text-sm font-black">{insight.title}</p><p className="text-xs text-slate-600 mt-1">{insight.desc}</p></div>))}</div>
                        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onGenerateAiInsights} className="min-h-10 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">重新生成</button><button type="button" onClick={onCloseAiPanel} className="min-h-10 rounded-xl bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700 dark:bg-slate-800 dark:text-slate-100">关闭</button></div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShippingLogisticsPanel;

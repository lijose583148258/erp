import React from 'react';
import { ArrowRightLeft, Camera, ClipboardList, Image as ImageIcon, Truck } from 'lucide-react';
import { Column } from '../../components/DataTable';
import { Shipment } from '../../types';

const getMsdsMeta = (row: Shipment, t: Record<string, string>) => {
    const status = String(row.msdsStatus || (row.msdsUrl ? 'valid' : 'missing')).toLowerCase();
    if (status === 'valid' || status === 'approved') {
        return { label: t.valid || '有效', dot: 'bg-emerald-500', text: 'text-emerald-700' };
    }
    if (status === 'expired') {
        return { label: t.expired || '已过期', dot: 'bg-amber-500', text: 'text-amber-700' };
    }
    return { label: t.missing || '缺失', dot: 'bg-rose-500', text: 'text-rose-700' };
};

export const buildShipmentColumns = (
    t: Record<string, string>,
    onUploadReceipt: (id: string) => void,
    onUpdateStatus: (id: string, status: 'in_transit' | 'exception') => void,
    onOpenReceiptEvents: (shipment: Shipment) => void,
): Column<Shipment>[] => [
    { header: t.shipmentId, key: 'id', accessor: (row) => <span className="font-mono font-bold">#{row.id || '-'}</span> },
    {
        header: t.orderRef,
        key: 'order',
        accessor: (row) => (
            <div className="flex flex-col">
                <span className="text-xs font-bold">{row.orderNo || row.orderId || '-'}</span>
                {row.id.includes('B2B') && (
                    <span className="text-xs font-black text-indigo-500 tracking-wide flex items-center mt-0.5">
                        <ArrowRightLeft size={8} className="mr-0.5" /> {t.backToBack}
                    </span>
                )}
            </div>
        )
    },
    {
        header: t.productName,
        key: 'product',
        accessor: (row) => (
            <div className="flex flex-col">
                <span className="text-xs font-bold">{row.productName || '-'}</span>
                <span className="text-xs text-slate-400 font-medium">CAS: {row.casNo || '-'}</span>
            </div>
        )
    },
    {
        header: t.msds,
        key: 'msds',
        accessor: (row) => {
            const meta = getMsdsMeta(row, t);
            return (
            <div className="flex items-center">
                <span className={`w-2 h-2 rounded-full mr-2 ${meta.dot}`} />
                <span className={`text-xs font-bold ${meta.text}`}>{meta.label}</span>
            </div>
            );
        }
    },
    { header: t.route, key: 'route', accessor: (row) => row.route || '-' },
    {
        header: t.status,
        key: 'status',
        accessor: (row: Shipment) => (
            <div className="flex flex-col gap-2">
                <span
                    data-testid={`shipment-status-${row.id}`}
                    className={`px-2.5 py-1 rounded-xl text-xs font-black tracking-wide ${row.status === 'delivered' ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' :
                        row.status === 'in_transit' ? 'bg-blue-100 text-blue-600 border border-blue-200' :
                        row.status === 'pending' ? 'bg-amber-100 text-amber-600 border border-amber-200' :
                        row.status === 'exception' ? 'bg-rose-100 text-rose-600 border border-rose-200' :
                        'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                >
                    {row.status === 'delivered' ? t.delivered : row.status === 'in_transit' ? t.activeTransit : row.status === 'pending' ? t.dispatchPending : (t.exception || '异常')}
                </span>
                {row.status === 'pending' && (
                    <button
                        type="button"
                        data-testid={`shipment-dispatch-${row.id}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onUpdateStatus(row.id, 'in_transit');
                        }}
                        className="inline-flex items-center justify-center rounded-xl bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-600 border border-blue-100 hover:bg-blue-100 transition-all"
                    >
                        <Truck size={12} className="mr-1" />
                        {t.arrangeDispatch || '发运'}
                    </button>
                )}
            </div>
        )
    },
    {
        header: t.coldChain,
        key: 'coldChain',
        accessor: (row: Shipment) => (
            <span className={`px-2.5 py-1 rounded-xl text-xs font-black tracking-wide ${row.isColdChain ? 'bg-cyan-100 text-cyan-700 border border-cyan-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                {row.isColdChain ? `${t.coldChain} ${row.temperature ?? '-'}°C` : t.no}
            </span>
        )
    },
    { header: t.batchNo, key: 'batchNo', accessor: (row) => row.batchNo || '-' },
    {
        header: t.proofOfDelivery,
        key: 'receipt',
        accessor: (row) => (
            <div className="flex flex-col gap-2">
                {row.signedReceiptUrl ? (
                    <a data-testid={`shipment-receipt-link-${row.id}`} href={row.signedReceiptUrl} target="_blank" rel="noreferrer" className="flex items-center text-emerald-600 hover:scale-105 transition-transform">
                        <ImageIcon size={14} className="mr-1.5" />
                        <span className="text-xs font-bold">{t.viewReceipt}</span>
                    </a>
                ) : (
                    <button data-testid={`shipment-receipt-button-${row.id}`} onClick={(e) => { e.stopPropagation(); onUploadReceipt(row.id); }} className="flex items-center text-blue-600 bg-blue-50 px-2 py-1 rounded-xl border border-blue-100 hover:bg-blue-100 transition-all">
                        <Camera size={14} className="mr-1.5" />
                        <span className="text-xs font-bold tracking-wide">{t.capturePod}</span>
                    </button>
                )}
                {row.status !== 'pending' && (
                    <button
                        data-testid={`shipment-receipts-button-${row.id}`}
                        onClick={(e) => { e.stopPropagation(); onOpenReceiptEvents(row); }}
                        className="flex items-center text-indigo-600 bg-indigo-50 px-2 py-1 rounded-xl border border-indigo-100 hover:bg-indigo-100 transition-all"
                    >
                        <ClipboardList size={14} className="mr-1.5" />
                        <span className="text-xs font-bold tracking-wide">签收批次</span>
                    </button>
                )}
            </div>
        )
    },
    { header: t.shippedAt, key: 'date', accessor: (row) => row.shippedAt || '-' },
];

export const renderSparkline = (values: number[]) => {
    const width = 160;
    const height = 48;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const points = values.map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - ((v - min) / range) * height;
        return `${x},${y}`;
    }).join(' ');
    return (
        <svg width={width} height={height} className="block">
            <polyline points={points} fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
};


import React from 'react';
import { ArrowRightLeft, Image as ImageIcon } from 'lucide-react';
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
    canWrite: boolean,
): Column<Shipment>[] => [
    {
        header: t.shipmentId,
        key: 'id',
        searchText: (row) => [
            row.id,
            row.shipmentNo,
            row.trackingNo,
        ].filter(Boolean).join(' '),
        accessor: (row) => (
            <div className="flex flex-col gap-1">
                <span className="font-mono font-bold">#{row.id || '-'}</span>
                <span className="font-mono text-[11px] font-bold text-slate-500">{row.shipmentNo || '-'}</span>
                {row.trackingNo ? (
                    <span className="font-mono text-[11px] font-black text-blue-600">{row.trackingNo}</span>
                ) : null}
            </div>
        )
    },
    {
        header: t.orderRef,
        key: 'order',
        searchText: (row) => [
            row.orderNo,
            row.orderId,
            row.customerName,
            row.customerNameZh,
            row.customerNameEn,
            row.customerNameVi,
        ].filter(Boolean).join(' '),
        accessor: (row) => (
            <div className="flex flex-col">
                <span className="text-xs font-bold">{row.orderNo || row.orderId || '-'}</span>
                <span className="mt-1 text-xs font-bold text-slate-400">{row.customerName || '-'}</span>
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
        searchText: (row) => [
            row.productName,
            row.sku,
            row.casNo,
        ].filter(Boolean).join(' '),
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
    { header: t.batchNo, key: 'batchNo', searchText: (row) => row.batchNo || '', accessor: (row) => row.batchNo || '-' },
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
                ) : canWrite ? (
                    <span className="inline-flex items-center rounded-xl border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">
                        {row.status === 'pending' ? (t.dispatchPending || '待发货') : (t.capturePod || '待上传 POD')}
                    </span>
                ) : (
                    <span className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-400">
                        只读凭证
                    </span>
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


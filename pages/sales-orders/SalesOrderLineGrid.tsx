import React, { useMemo, useState } from 'react';
import { ClipboardPaste, CopyPlus, Plus, Rows4, Trash2 } from 'lucide-react';
import { SalesOrderItem } from '../../types';
import type { SalesOrderFormData } from './useSalesOrders';

type Props = {
    t: Record<string, string>;
    formData: SalesOrderFormData;
    updateOrderItem: (index: number, patch: Partial<SalesOrderItem>) => void;
    addOrderItem: (seed?: Partial<SalesOrderItem>) => void;
    duplicateOrderItem: (index: number) => void;
    removeOrderItem: (index: number) => void;
    importOrderItemsFromGrid: (rawText: string) => void;
    formatPrice: (amount: number) => string;
    totals: {
        subtotal?: number;
        totalDiscount: number;
        totalTax: number;
        grandTotal: number;
        estComm: number;
        totalCBM: number;
        totalWeight: number;
    };
};

const baseInputClass =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900';

const SalesOrderLineGrid: React.FC<Props> = ({
    t,
    formData,
    updateOrderItem,
    addOrderItem,
    duplicateOrderItem,
    removeOrderItem,
    importOrderItemsFromGrid,
    formatPrice,
    totals,
}) => {
    const [pasteText, setPasteText] = useState('');
    const [showPastePanel, setShowPastePanel] = useState(false);

    const summaryItems = useMemo(
        () => [
            { label: t.subtotal || '小计', value: formatPrice(totals.subtotal || totals.grandTotal - totals.totalTax) },
            { label: t.discount || '折扣', value: formatPrice(totals.totalDiscount) },
            { label: t.tax || '税额', value: formatPrice(totals.totalTax) },
            { label: t.grandTotal || '总额', value: formatPrice(totals.grandTotal) },
            { label: t.totalVol || '总体积', value: `${totals.totalCBM.toFixed(3)} m3` },
            { label: t.totalWeight || '总重量', value: `${totals.totalWeight.toFixed(2)} kg` },
        ],
        [formatPrice, t, totals],
    );

    const handlePasteImport = () => {
        importOrderItemsFromGrid(pasteText);
        setPasteText('');
        setShowPastePanel(false);
    };

    return (
        <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
                        {t.orderLineGridTitle || '订单明细 Excel 网格'}
                    </h3>
                    <p className="mt-2 text-sm text-slate-400">
                        {t.orderLineGridHint || '这里专门录明细行，按行连续输入、复制、粘贴，不再把订单头字段混进来。'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => addOrderItem()}
                        className="inline-flex items-center rounded-[18px] bg-blue-600 px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-white shadow-lg transition hover:bg-blue-700"
                    >
                        <Plus size={14} className="mr-2" />
                        {t.addLine || '新增行'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowPastePanel((current) => !current)}
                        className="inline-flex items-center rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                        <ClipboardPaste size={14} className="mr-2" />
                        {t.pasteExcel || '粘贴 Excel'}
                    </button>
                </div>
            </div>

            {showPastePanel && (
                <div className="mb-5 rounded-[24px] border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-900/10">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
                        <Rows4 size={14} />
                        {t.pasteExcelHintTitle || 'Excel 粘贴区'}
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {t.pasteExcelHint || '按列顺序粘贴：品名\t规格\t数量\t单位\t单价\t折扣\t税额'}
                    </p>
                    <textarea
                        value={pasteText}
                        onChange={(event) => setPasteText(event.target.value)}
                        placeholder={'产品A\t25kg/桶\t20\t桶\t180\t0\t23\n产品B\t2440x1220x18mm\t60\t张\t210\t10\t120'}
                        className="mt-3 h-28 w-full rounded-[20px] border border-blue-100 bg-white px-4 py-3 font-mono text-xs outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setShowPastePanel(false);
                                setPasteText('');
                            }}
                            className="rounded-[16px] bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-800 dark:text-slate-200"
                        >
                            {t.cancel || '取消'}
                        </button>
                        <button
                            type="button"
                            onClick={handlePasteImport}
                            className="rounded-[16px] bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white"
                        >
                            {t.apply || '导入'}
                        </button>
                    </div>
                </div>
            )}

            <div className="overflow-x-auto rounded-[24px] border border-slate-100 dark:border-slate-800">
                <table className="min-w-[1080px] w-full border-collapse">
                    <thead className="bg-slate-50/90 dark:bg-slate-800/60">
                        <tr>
                            {['#', t.productName || '品名', t.specification || '规格/尺寸', t.phQty || '数量', t.phUnit || '单位', t.phPrice || '单价', t.discount || '折扣', t.tax || '税额', t.amount || '金额', t.mode || '模式', t.actions || '操作'].map((label) => (
                                <th key={label} className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                                    {label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {formData.items.map((item, index) => {
                            const lineAmount = (Number(item.quantity || 0) * Number(item.unitPrice || 0)) - Number(item.discount || 0) + Number(item.taxAmount || 0);

                            return (
                                <tr key={`${index}-${item.productName}-${item.batchNo || ''}`} className="border-b border-slate-100 align-top last:border-b-0 dark:border-slate-800">
                                    <td className="px-3 py-3 text-xs font-black text-slate-400">{index + 1}</td>
                                    <td className="px-3 py-3">
                                        <input
                                            value={item.productName}
                                            onChange={(event) => updateOrderItem(index, { productName: event.target.value })}
                                            placeholder={t.productName || '产品名称'}
                                            data-testid={`sales-order-line-${index}-product`}
                                            className={baseInputClass}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        {item.isDimensional ? (
                                            <div className="grid grid-cols-3 gap-2">
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    value={item.dimLength || 0}
                                                    onChange={(event) => updateOrderItem(index, { dimLength: Number(event.target.value) || 0 })}
                                                    placeholder={t.phLength || '长'}
                                                    className={baseInputClass}
                                                />
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    value={item.dimWidth || 0}
                                                    onChange={(event) => updateOrderItem(index, { dimWidth: Number(event.target.value) || 0 })}
                                                    placeholder={t.phWidth || '宽'}
                                                    className={baseInputClass}
                                                />
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    value={item.dimHeight || 0}
                                                    onChange={(event) => updateOrderItem(index, { dimHeight: Number(event.target.value) || 0 })}
                                                    placeholder={t.phHeight || '厚'}
                                                    className={baseInputClass}
                                                />
                                            </div>
                                        ) : (
                                            <input
                                                value={item.packagingSpec}
                                                onChange={(event) => updateOrderItem(index, { packagingSpec: event.target.value })}
                                                placeholder={t.phPackaging || '包装规格'}
                                                data-testid={`sales-order-line-${index}-packaging`}
                                                className={baseInputClass}
                                            />
                                        )}
                                        {item.isDimensional && (
                                            <div className="mt-2 flex gap-3 text-[10px] font-bold text-slate-400">
                                                <span>{t.totalVol || '总体积'} {item.totalVolume || 0}</span>
                                                <span>{t.totalWeight || '总重量'} {item.totalWeight || 0}</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={item.quantity}
                                            onChange={(event) => updateOrderItem(index, { quantity: Number(event.target.value) || 0 })}
                                            data-testid={`sales-order-line-${index}-quantity`}
                                            className={baseInputClass}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            value={item.unit}
                                            onChange={(event) => updateOrderItem(index, { unit: event.target.value })}
                                            data-testid={`sales-order-line-${index}-unit`}
                                            className={baseInputClass}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={item.unitPrice}
                                            onChange={(event) => updateOrderItem(index, { unitPrice: Number(event.target.value) || 0 })}
                                            data-testid={`sales-order-line-${index}-unit-price`}
                                            className={baseInputClass}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={item.discount}
                                            onChange={(event) => updateOrderItem(index, { discount: Number(event.target.value) || 0 })}
                                            data-testid={`sales-order-line-${index}-discount`}
                                            className={baseInputClass}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={item.taxAmount}
                                            onChange={(event) => updateOrderItem(index, { taxAmount: Number(event.target.value) || 0 })}
                                            data-testid={`sales-order-line-${index}-tax`}
                                            className={baseInputClass}
                                        />
                                    </td>
                                    <td className="px-3 py-3 text-right">
                                        <div className="rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs font-black text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                                            {formatPrice(lineAmount)}
                                        </div>
                                    </td>
                                    <td className="px-3 py-3">
                                        <button
                                            type="button"
                                            onClick={() => updateOrderItem(index, { isDimensional: !item.isDimensional })}
                                            className={`rounded-[16px] px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] ${
                                                item.isDimensional
                                                    ? 'bg-indigo-600 text-white'
                                                    : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                            }`}
                                        >
                                            {item.isDimensional ? (t.dimensionMode || '尺寸') : (t.standardMode || '常规')}
                                        </button>
                                    </td>
                                    <td className="px-3 py-3">
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => duplicateOrderItem(index)}
                                                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                                title={t.duplicateRow || '复制一行'}
                                            >
                                                <CopyPlus size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeOrderItem(index)}
                                                className="rounded-xl border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50 dark:border-rose-900/40 dark:hover:bg-rose-950/20"
                                                title={t.deleteLine || '删除行'}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                {summaryItems.map((item) => (
                    <div key={item.label} className="rounded-[22px] border border-slate-100 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
                        <div className="mt-2 text-sm font-black text-slate-800 dark:text-slate-100">{item.value}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SalesOrderLineGrid;

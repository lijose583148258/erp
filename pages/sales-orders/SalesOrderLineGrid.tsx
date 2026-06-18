import React, { useMemo, useState } from 'react';
import { ClipboardPaste, CopyPlus, Plus, Rows4, Trash2 } from 'lucide-react';
import { SalesOrderItem } from '../../types';
import type { SalesOrderFormData } from './useSalesOrders';
import type { SalesOrderLineErrors } from './salesOrderFormHelpers';

type Props = {
    t: Record<string, string>;
    formData: SalesOrderFormData;
    updateOrderItem: (index: number, patch: Partial<SalesOrderItem>) => void;
    addOrderItem: (seed?: Partial<SalesOrderItem>) => void;
    duplicateOrderItem: (index: number) => void;
    removeOrderItem: (index: number) => void;
    importOrderItemsFromGrid: (rawText: string) => void;
    formatPrice: (amount: number) => string;
    lineErrors: SalesOrderLineErrors;
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

const rowsPerPage = 50;
const hasLineError = (errors: string[], keyword: string) => errors.some(error => error.includes(keyword));

const SalesOrderLineGrid: React.FC<Props> = ({
    t,
    formData,
    updateOrderItem,
    addOrderItem,
    duplicateOrderItem,
    removeOrderItem,
    importOrderItemsFromGrid,
    formatPrice,
    lineErrors,
    totals,
}) => {
    const [pasteText, setPasteText] = useState('');
    const [showPastePanel, setShowPastePanel] = useState(false);
    const [page, setPage] = useState(0);
    const pageCount = Math.max(1, Math.ceil(formData.items.length / rowsPerPage));
    const safePage = Math.min(page, pageCount - 1);
    const pageStart = safePage * rowsPerPage;
    const visibleItems = formData.items.slice(pageStart, pageStart + rowsPerPage).map((item, offset) => ({
        item,
        index: pageStart + offset,
    }));

    React.useEffect(() => {
        if (page !== safePage) setPage(safePage);
    }, [page, safePage]);

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
        setPage(0);
    };
    const errorCount = Object.keys(lineErrors).length;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
                        {t.orderLineGridTitle || '订单明细 Excel 网格'}
                    </h3>
                    <p className="mt-1.5 text-sm text-slate-500">
                        {t.orderLineGridHint || '这里专门录明细行，按行连续输入、复制、粘贴，不再把订单头字段混进来。'}
                    </p>
                    {errorCount > 0 && (
                        <div data-testid="sales-order-line-error-summary" className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
                            还有 {errorCount} 行明细未完成，请按红色提示逐行修正后再保存。
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => addOrderItem()}
                        className="inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-blue-700"
                    >
                        <Plus size={14} className="mr-2" />
                        {t.addLine || '新增行'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowPastePanel((current) => !current)}
                        className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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
                        maxLength={20000}
                        placeholder={'产品A\t25kg/桶\t20\t桶\t180\t0\t23\n产品B\t2440x1220x18mm\t60\t张\t210\t10\t120'}
                        className="mt-3 h-28 w-full rounded-[20px] border border-blue-100 bg-white px-4 py-3 font-mono text-xs outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
                    />
                    <div className="mt-1 text-right text-xs font-medium text-slate-500">{pasteText.length}/20000</div>
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

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full min-w-[960px] table-fixed border-collapse">
                    <colgroup>
                        <col className="w-10" />
                        <col className="w-44" />
                        <col className="w-48" />
                        <col className="w-24" />
                        <col className="w-20" />
                        <col className="w-28" />
                        <col className="w-24" />
                        <col className="w-24" />
                        <col className="w-32" />
                        <col className="w-24" />
                        <col className="w-24" />
                    </colgroup>
                    <thead className="bg-slate-50/90 dark:bg-slate-800/60">
                        <tr>
                            {['#', t.productName || '品名', t.specification || '规格/尺寸', t.phQty || '数量', t.phUnit || '单位', t.phPrice || '单价', t.discount || '折扣', t.tax || '税额', t.amount || '金额', t.mode || '模式', t.actions || '操作'].map((label) => (
                                <th key={label} className="whitespace-nowrap border-b border-slate-100 px-2.5 py-2.5 text-left text-xs font-black text-slate-600 dark:border-slate-800 dark:text-slate-300">
                                    {label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visibleItems.map(({ item, index }) => {
                            const lineAmount = (Number(item.quantity || 0) * Number(item.unitPrice || 0)) - Number(item.discount || 0) + Number(item.taxAmount || 0);
                            const currentLineErrors = lineErrors[index] || [];
                            const errorId = `sales-order-line-${index}-errors`;

                            return (
                                <tr key={`${index}-${item.productName}-${item.batchNo || ''}`} className={`border-b align-top last:border-b-0 ${currentLineErrors.length ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/10' : 'border-slate-100 dark:border-slate-800'}`}>
                                    <td className="px-3 py-3 text-xs font-black text-slate-400">{index + 1}</td>
                                    <td className="px-3 py-3">
                                        <input
                                            value={item.productName}
                                            onChange={(event) => updateOrderItem(index, { productName: event.target.value })}
                                            maxLength={120}
                                            placeholder={t.productName || '产品名称'}
                                            data-testid={`sales-order-line-${index}-product`}
                                            aria-invalid={hasLineError(currentLineErrors, '商品名称')}
                                            aria-describedby={currentLineErrors.length ? errorId : undefined}
                                            className={`${baseInputClass} ${hasLineError(currentLineErrors, '商品名称') ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100 dark:border-rose-800 dark:bg-rose-950/20' : ''}`}
                                        />
                                        {currentLineErrors.length > 0 && (
                                            <div id={errorId} data-testid={`sales-order-line-${index}-errors`} className="mt-2 space-y-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-[11px] font-bold text-rose-600 dark:border-rose-900/50 dark:bg-slate-950 dark:text-rose-200">
                                                {currentLineErrors.map((error) => (
                                                    <div key={error}>第 {index + 1} 行：{error}</div>
                                                ))}
                                            </div>
                                        )}
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
                                                maxLength={120}
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
                                            aria-invalid={hasLineError(currentLineErrors, '数量')}
                                            aria-describedby={currentLineErrors.length ? errorId : undefined}
                                            className={`${baseInputClass} ${hasLineError(currentLineErrors, '数量') ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100 dark:border-rose-800 dark:bg-rose-950/20' : ''}`}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            value={item.unit}
                                            onChange={(event) => updateOrderItem(index, { unit: event.target.value })}
                                            maxLength={20}
                                            data-testid={`sales-order-line-${index}-unit`}
                                            aria-invalid={hasLineError(currentLineErrors, '单位')}
                                            aria-describedby={currentLineErrors.length ? errorId : undefined}
                                            className={`${baseInputClass} ${hasLineError(currentLineErrors, '单位') ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100 dark:border-rose-800 dark:bg-rose-950/20' : ''}`}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={item.unitPrice}
                                            onChange={(event) => updateOrderItem(index, { unitPrice: Number(event.target.value) || 0 })}
                                            data-testid={`sales-order-line-${index}-unit-price`}
                                            aria-invalid={hasLineError(currentLineErrors, '单价')}
                                            aria-describedby={currentLineErrors.length ? errorId : undefined}
                                            className={`${baseInputClass} ${hasLineError(currentLineErrors, '单价') ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100 dark:border-rose-800 dark:bg-rose-950/20' : ''}`}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={item.discount}
                                            onChange={(event) => updateOrderItem(index, { discount: Number(event.target.value) || 0 })}
                                            data-testid={`sales-order-line-${index}-discount`}
                                            aria-invalid={hasLineError(currentLineErrors, '折扣')}
                                            aria-describedby={currentLineErrors.length ? errorId : undefined}
                                            className={`${baseInputClass} ${hasLineError(currentLineErrors, '折扣') ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100 dark:border-rose-800 dark:bg-rose-950/20' : ''}`}
                                        />
                                    </td>
                                    <td className="px-3 py-3">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={item.taxAmount}
                                            onChange={(event) => updateOrderItem(index, { taxAmount: Number(event.target.value) || 0 })}
                                            data-testid={`sales-order-line-${index}-tax`}
                                            aria-invalid={hasLineError(currentLineErrors, '税额')}
                                            aria-describedby={currentLineErrors.length ? errorId : undefined}
                                            className={`${baseInputClass} ${hasLineError(currentLineErrors, '税额') ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100 dark:border-rose-800 dark:bg-rose-950/20' : ''}`}
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
                                                aria-label={t.duplicateRow || '复制一行'}
                                                className="min-h-11 min-w-11 rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                                title={t.duplicateRow || '复制一行'}
                                            >
                                                <CopyPlus size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeOrderItem(index)}
                                                aria-label={t.deleteLine || '删除行'}
                                                className="min-h-11 min-w-11 rounded-xl border border-rose-300 p-2 text-rose-600 transition hover:bg-rose-50 dark:border-rose-900/40 dark:hover:bg-rose-950/20"
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

            {pageCount > 1 ? (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                        {t.orderLinePaging || '明细较多，已分页显示'}：
                        {pageStart + 1}-{Math.min(pageStart + rowsPerPage, formData.items.length)} / {formData.items.length}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.max(0, current - 1))}
                            disabled={safePage === 0}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-black disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
                        >
                            {t.previousPage || '上一页'}
                        </button>
                        <span className="min-w-16 text-center font-black">{safePage + 1} / {pageCount}</span>
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                            disabled={safePage >= pageCount - 1}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-black disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
                        >
                            {t.nextPage || '下一页'}
                        </button>
                    </div>
                </div>
            ) : null}

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

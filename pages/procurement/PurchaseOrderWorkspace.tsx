import React, { type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowRightLeft, CheckCircle, ChevronDown, Link, Plus, ShieldCheck } from 'lucide-react';
import { EnterpriseDataGrid, FormField, type EnterpriseColumn } from '../../components/ui';
import { MaterialMasterCombobox } from '../../components/materials/MaterialMasterCombobox';
import type { PurchaseOrder, Supplier } from '../../services/procurement.service';
import type { SalesOrder } from '../../types';
import type { NewPurchaseOrderForm, ProcurementFormErrors, PurchaseCostPreview } from './procurementForms';

type PurchaseOrderWorkspaceProps = {
  t: any;
  mode?: 'orders' | 'receipts';
  orders: PurchaseOrder[];
  purchaseOrderColumns: EnterpriseColumn<PurchaseOrder>[];
  purchaseSearch: string;
  setPurchaseSearch: (value: string) => void;
  isLoading: boolean;
  renderPurchaseOrderActions: (order: PurchaseOrder) => ReactNode;
  newOrder: NewPurchaseOrderForm;
  setNewOrder: Dispatch<SetStateAction<NewPurchaseOrderForm>>;
  purchaseErrors: ProcurementFormErrors;
  clearPurchaseError: (field: string) => void;
  addOrder: () => void;
  isB2B: boolean;
  setIsB2B: Dispatch<SetStateAction<boolean>>;
  salesOrders: SalesOrder[];
  b2bLinks: Record<string, { linked: boolean; purchaseOrder?: PurchaseOrder }>;
  suppliers: Supplier[];
  getSupplierLabel: (supplier?: Pick<Supplier, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'supplierDisplayName'> | null) => string;
  purchaseCostPreview: PurchaseCostPreview;
  canWrite: boolean;
  isSubmitting: boolean;
};

export const PurchaseOrderWorkspace = ({
  t,
  mode = 'orders',
  orders,
  purchaseOrderColumns,
  purchaseSearch,
  setPurchaseSearch,
  isLoading,
  renderPurchaseOrderActions,
  newOrder,
  setNewOrder,
  purchaseErrors,
  clearPurchaseError,
  addOrder,
  isB2B,
  setIsB2B,
  salesOrders,
  b2bLinks,
  suppliers,
  getSupplierLabel,
  purchaseCostPreview,
  canWrite,
  isSubmitting,
}: PurchaseOrderWorkspaceProps) => {
  const isReceiptMode = mode === 'receipts';
  const [showAdvancedOrderFields, setShowAdvancedOrderFields] = React.useState(false);
  const updateOrderField = (field: keyof NewPurchaseOrderForm, value: string) => {
    clearPurchaseError(field);
    setNewOrder(prev => ({ ...prev, [field]: value }));
  };
  const purchaseErrorCount = Object.keys(purchaseErrors).length;
  const advancedSummary = [
    isB2B ? '已启用背靠背关联' : '',
    newOrder.currency !== 'CNY' ? `币种 ${newOrder.currency}` : '',
    Number(newOrder.freightCost || 0) > 0 ? '已填运费' : '',
    Number(newOrder.dutyCost || 0) > 0 ? '已填关税' : '',
  ].filter(Boolean).join(' · ') || '币种/汇率/税费/背靠背可稍后补充';

  return (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <div className={`${isReceiptMode ? 'lg:col-span-12' : 'lg:col-span-8'} app-card p-6`}>
      {isReceiptMode ? (
        <div className="mb-4 rounded-[28px] border border-emerald-100 bg-emerald-50/70 px-5 py-4 text-xs font-bold leading-6 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
          当前是收货职责区，只显示可收货订单队列。新增采购单请切回“采购订单”职责区，收货批次会从订单行右侧按钮进入并保存后回读。
        </div>
      ) : (
        <section data-testid="procurement-order-boundary" className="mb-4 rounded-[28px] border border-blue-100 bg-blue-50/80 p-4 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/30">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-2xl bg-white p-2 text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-300">
              <ShieldCheck size={16} />
            </div>
            <div>
              <h3 className="text-sm font-black tracking-tight text-slate-950 dark:text-white">采购订单主入口</h3>
              <p className="mt-2 text-xs font-bold leading-6 text-slate-600 dark:text-slate-300">
                这里记录供应商、物料、数量、价格、到岸成本和关联销售单，是采购承诺，不是库存流水。真实收货必须从订单行进入收货批次，保存后再回读库存和差异。
              </p>
            </div>
          </div>
        </section>
      )}
      <EnterpriseDataGrid
        data={orders}
        columns={purchaseOrderColumns}
        rowKey="id"
        title={isReceiptMode ? '可收货订单队列' : t.purchaseOrders}
        description={isReceiptMode ? '从已批准、在途或已收货订单进入收货批次，不在这里新建采购单。' : t.backToBack}
        searchValue={purchaseSearch}
        onSearchChange={setPurchaseSearch}
        searchPlaceholder={t.search}
        loading={isLoading}
        emptyTitle={isReceiptMode ? '暂无可收货订单' : (t.noData || '暂无采购订单')}
        emptyDescription={isReceiptMode ? '请先在采购订单区完成审批或发运，再回到这里登记收货批次。' : (t.selectSupplier || '请在右侧选择供应商并新增采购单。')}
        getRowTestId={(order) => `purchase-order-card-${order.id}`}
        rowActions={renderPurchaseOrderActions}
        defaultPageSize={8}
      />
    </div>

    {!isReceiptMode ? (
    <div className="lg:col-span-4 app-card mb-28 flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden p-0 lg:sticky lg:top-6 lg:mb-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 dark:border-slate-800">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t.addPurchase}</h3>
        <Plus size={16} className="text-slate-400" />
      </div>
      {!canWrite ? (
        <div className="m-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm font-bold leading-6 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          当前角色只能查看采购单，新增采购单、审批、发运和收货需要采购写入权限。
        </div>
      ) : (
      <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 pr-4">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-xs font-bold leading-6 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200">
          先填“供应商、物料、数量、单价、预计到货”即可生成采购承诺。背靠背销售单、外币汇率、税费和到岸成本是高级信息，展开后补齐。
        </div>
        {purchaseErrorCount > 0 && (
          <div data-testid="purchase-form-error-summary" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
            还有 {purchaseErrorCount} 项采购单信息需要修正：{Object.values(purchaseErrors)[0]}
          </div>
        )}
        <fieldset className="space-y-3 rounded-3xl border border-slate-200/80 p-4 dark:border-slate-700">
          <legend className="px-2 text-xs font-black tracking-wide text-slate-800 dark:text-slate-100">
            1. 采购对象
          </legend>
          <p className="text-[11px] font-semibold leading-5 text-slate-500 dark:text-slate-400">
            先选供应商，再从统一物料中查找本次采购品。选中物料后，名称和基础单位会随主数据锁定。
          </p>
          <FormField
            dataTestId="purchase-supplier-select"
            label="供应商"
            as="select"
            value={newOrder.supplierId}
            onChange={(value) => updateOrderField('supplierId', value)}
            options={[
              { value: '', label: t.selectSupplier },
              ...suppliers.map(supplier => ({ value: supplier.id, label: getSupplierLabel(supplier) || supplier.name })),
            ]}
            required
            error={purchaseErrors.supplierId}
          />
          <MaterialMasterCombobox
            dataTestId="purchase-item-input"
            value={newOrder.item}
            selectedMaterialId={newOrder.materialId ? Number(newOrder.materialId) : null}
            error={purchaseErrors.item}
            onTextChange={(value) => updateOrderField('item', value)}
            onClearSelection={() => setNewOrder(prev => ({ ...prev, materialId: '' }))}
            onSelect={(material) => {
              clearPurchaseError('item');
              setNewOrder(prev => ({
                ...prev,
                materialId: String(material.id),
                item: material.nameZh,
                unit: material.baseUnit,
              }));
            }}
          />
        </fieldset>
        <fieldset className="space-y-3 rounded-3xl border border-slate-200/80 p-4 dark:border-slate-700">
          <legend className="px-2 text-xs font-black tracking-wide text-slate-800 dark:text-slate-100">
            2. 数量、价格与到货
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <FormField dataTestId="purchase-quantity-input" type="number" label="采购数量" value={newOrder.quantity} onChange={(value) => updateOrderField('quantity', value)} placeholder="0" error={purchaseErrors.quantity} required />
            <FormField dataTestId="purchase-unit-input" label="计量单位" value={newOrder.unit} onChange={(value) => updateOrderField('unit', value)} placeholder={t.unit} error={purchaseErrors.unit} maxLength={20} readOnly={Boolean(newOrder.materialId)} hint={newOrder.materialId ? '来自统一物料主数据' : '未关联物料时需人工确认'} required />
            <FormField className="col-span-2" dataTestId="purchase-price-input" type="number" label={`采购单价（${newOrder.currency || 'CNY'}）`} value={newOrder.price} onChange={(value) => updateOrderField('price', value)} placeholder="0.00" error={purchaseErrors.price} required />
          </div>
          <FormField dataTestId="purchase-eta-input" type="date" value={newOrder.eta} onChange={(value) => updateOrderField('eta', value)} label="预计到货日期" error={purchaseErrors.eta} required />
        </fieldset>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/20">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">到岸成本</p>
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
              CNY {purchaseCostPreview.landedUnitCost.toLocaleString()} / {newOrder.unit || t.unit}
            </p>
          </div>
          <p className="mt-3 text-[11px] font-bold text-emerald-700/80 dark:text-emerald-300/80">
            预估总到岸成本：CNY {purchaseCostPreview.landedCostAmount.toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          data-testid="purchase-toggle-advanced"
          onClick={() => setShowAdvancedOrderFields(prev => !prev)}
          aria-expanded={showAdvancedOrderFields}
          aria-controls="purchase-advanced-fields"
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-xs font-black text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-blue-950/30"
        >
          <span>{showAdvancedOrderFields ? '收起高级采购信息' : '展开高级采购信息'} · {advancedSummary}</span>
          <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${showAdvancedOrderFields ? 'rotate-180' : ''}`} />
        </button>
        {showAdvancedOrderFields ? (
          <div id="purchase-advanced-fields" className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="flex items-center justify-between rounded-2xl border border-indigo-100 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-900/20">
              <div className="flex items-center">
                <ArrowRightLeft size={16} className="mr-2 text-indigo-600" />
                <span className="text-xs font-black uppercase tracking-widest text-indigo-700">{t.backToBack}</span>
              </div>
              <button
                type="button"
                data-testid="b2b-toggle"
                onClick={() => setIsB2B(!isB2B)}
                role="switch"
                aria-checked={isB2B}
                aria-label="启用背靠背销售单关联"
                className={`relative h-6 w-11 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none ${isB2B ? 'bg-indigo-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none ${isB2B ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {isB2B && (
              <div className="space-y-2">
                <select
                  data-testid="linked-sales-order-select"
                  value={newOrder.salesOrderRef}
                  onChange={e => updateOrderField('salesOrderRef', e.target.value)}
                  className="app-control w-full bg-indigo-50/50 text-xs font-bold dark:bg-indigo-900/10"
                >
                  <option value="">{t.selectLinkedSalesOrder}</option>
                  {salesOrders.filter(so => so.status !== 'cancelled').map(so => {
                    const salesOrderNo = (so as any).orderNo || so.id;
                    return (
                      <option key={so.id} value={so.id}>
                        {salesOrderNo} - {so.customerDisplayName || so.customerName || so.customerNameZh || ''} ({so.items?.length || 0}{t.itemsUnit})
                      </option>
                    );
                  })}
                </select>
                {newOrder.salesOrderRef && b2bLinks[newOrder.salesOrderRef] && (
                  <div className={`flex items-center gap-1 rounded-lg p-2 text-[11px] font-bold ${b2bLinks[newOrder.salesOrderRef].linked ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {b2bLinks[newOrder.salesOrderRef].linked ? (
                      <><CheckCircle size={10} />{t.purchaseAlreadyLinked}</>
                    ) : (
                      <><Link size={10} />{t.purchaseNotLinked}</>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                dataTestId="purchase-currency-select"
                label="币种"
                as="select"
                value={newOrder.currency}
                onChange={(value) => {
                  clearPurchaseError('exchangeRate');
                  updateOrderField('currency', value);
                  if (value === 'CNY') updateOrderField('exchangeRate', '1');
                }}
                options={[
                  { value: 'CNY', label: 'CNY' },
                  { value: 'USD', label: 'USD' },
                  { value: 'VND', label: 'VND' },
                ]}
                error={purchaseErrors.currency}
                inputClassName="bg-white dark:bg-slate-900"
              />
              <FormField dataTestId="purchase-exchange-rate-input" label="汇率" value={newOrder.exchangeRate} onChange={(value) => updateOrderField('exchangeRate', value)} placeholder="1 CNY = X" error={purchaseErrors.exchangeRate} inputClassName="bg-white dark:bg-slate-900" />
              <FormField dataTestId="purchase-tax-rate-input" label="税率%" value={newOrder.taxRate} onChange={(value) => updateOrderField('taxRate', value)} error={purchaseErrors.taxRate} inputClassName="bg-white dark:bg-slate-900" />
              <FormField dataTestId="purchase-tax-amount-input" label="税额" value={newOrder.taxAmount} onChange={(value) => updateOrderField('taxAmount', value)} placeholder="留空自动按税率" error={purchaseErrors.taxAmount} inputClassName="bg-white dark:bg-slate-900" />
              <FormField dataTestId="purchase-freight-cost-input" label="运费(CNY)" value={newOrder.freightCost} onChange={(value) => updateOrderField('freightCost', value)} error={purchaseErrors.freightCost} inputClassName="bg-white dark:bg-slate-900" />
              <FormField dataTestId="purchase-duty-cost-input" label="关税(CNY)" value={newOrder.dutyCost} onChange={(value) => updateOrderField('dutyCost', value)} error={purchaseErrors.dutyCost} inputClassName="bg-white dark:bg-slate-900" />
              <FormField dataTestId="purchase-insurance-cost-input" label="保险(CNY)" value={newOrder.insuranceCost} onChange={(value) => updateOrderField('insuranceCost', value)} error={purchaseErrors.insuranceCost} inputClassName="bg-white dark:bg-slate-900" />
              <FormField dataTestId="purchase-other-cost-input" label="其他(CNY)" value={newOrder.otherCost} onChange={(value) => updateOrderField('otherCost', value)} error={purchaseErrors.otherCost} inputClassName="bg-white dark:bg-slate-900" />
            </div>
          </div>
        ) : null}
      </div>
      <div className="border-t border-slate-100 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <p className="mb-2 text-[11px] font-semibold leading-5 text-slate-500 dark:text-slate-400">
          保存后生成采购承诺；不会立即增加库存。实际库存只在后续收货批次确认后写入。
        </p>
        <button
          type="button"
          data-testid="save-purchase-button"
          onClick={addOrder}
          disabled={!canWrite || isSubmitting}
          aria-busy={isSubmitting}
          className="w-full scroll-mb-28 rounded-2xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-appLift transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 lg:scroll-mb-0"
        >
          {isSubmitting ? (t.saving || '保存中...') : '保存采购承诺'}
        </button>
      </div>
      </>
      )}
    </div>
    ) : null}
  </div>
  );
};

import React, { type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowRightLeft, CheckCircle, Link, Plus } from 'lucide-react';
import { EnterpriseDataGrid, FormField, type EnterpriseColumn } from '../../components/ui';
import type { PurchaseOrder, Supplier } from '../../services/procurement.service';
import type { SalesOrder } from '../../types';
import type { NewPurchaseOrderForm, PurchaseCostPreview } from './procurementForms';

type PurchaseOrderWorkspaceProps = {
  t: any;
  orders: PurchaseOrder[];
  purchaseOrderColumns: EnterpriseColumn<PurchaseOrder>[];
  purchaseSearch: string;
  setPurchaseSearch: (value: string) => void;
  isLoading: boolean;
  renderPurchaseOrderActions: (order: PurchaseOrder) => ReactNode;
  newOrder: NewPurchaseOrderForm;
  setNewOrder: Dispatch<SetStateAction<NewPurchaseOrderForm>>;
  addOrder: () => void;
  isB2B: boolean;
  setIsB2B: Dispatch<SetStateAction<boolean>>;
  salesOrders: SalesOrder[];
  b2bLinks: Record<string, { linked: boolean; purchaseOrder?: PurchaseOrder }>;
  suppliers: Supplier[];
  getSupplierLabel: (supplier?: Pick<Supplier, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'supplierDisplayName'> | null) => string;
  purchaseCostPreview: PurchaseCostPreview;
};

export const PurchaseOrderWorkspace = ({
  t,
  orders,
  purchaseOrderColumns,
  purchaseSearch,
  setPurchaseSearch,
  isLoading,
  renderPurchaseOrderActions,
  newOrder,
  setNewOrder,
  addOrder,
  isB2B,
  setIsB2B,
  salesOrders,
  b2bLinks,
  suppliers,
  getSupplierLabel,
  purchaseCostPreview,
}: PurchaseOrderWorkspaceProps) => (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <div className="lg:col-span-8 app-card p-6">
      <EnterpriseDataGrid
        data={orders}
        columns={purchaseOrderColumns}
        rowKey="id"
        title={t.purchaseOrders}
        description={t.backToBack}
        searchValue={purchaseSearch}
        onSearchChange={setPurchaseSearch}
        searchPlaceholder={t.search}
        loading={isLoading}
        emptyTitle={t.noData || '暂无采购订单'}
        emptyDescription={t.selectSupplier || '请在右侧选择供应商并新增采购单。'}
        getRowTestId={(order) => `purchase-order-card-${order.id}`}
        rowActions={renderPurchaseOrderActions}
        defaultPageSize={8}
      />
    </div>

    <div className="lg:col-span-4 app-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t.addPurchase}</h3>
        <Plus size={16} className="text-slate-400" />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800">
          <div className="flex items-center">
            <ArrowRightLeft size={16} className="text-indigo-600 mr-2" />
            <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">{t.backToBack}</span>
          </div>
          <button
            data-testid="b2b-toggle"
            onClick={() => setIsB2B(!isB2B)}
            className={`w-10 h-5 rounded-full transition-all relative ${isB2B ? 'bg-indigo-600' : 'bg-slate-300'}`}
          >
            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isB2B ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        {isB2B && (
          <div className="space-y-2">
            <select
              data-testid="linked-sales-order-select"
              value={newOrder.salesOrderRef}
              onChange={e => setNewOrder(prev => ({ ...prev, salesOrderRef: e.target.value }))}
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
              <div className={`p-2 rounded-lg text-[11px] font-bold flex items-center gap-1 ${b2bLinks[newOrder.salesOrderRef].linked ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                {b2bLinks[newOrder.salesOrderRef].linked ? (
                  <><CheckCircle size={10} />{t.purchaseAlreadyLinked}</>
                ) : (
                  <><Link size={10} />{t.purchaseNotLinked}</>
                )}
              </div>
            )}
          </div>
        )}

        <FormField
          dataTestId="purchase-supplier-select"
          as="select"
          value={newOrder.supplierId}
          onChange={(value) => setNewOrder(prev => ({ ...prev, supplierId: value }))}
          options={[
            { value: '', label: t.selectSupplier },
            ...suppliers.map(supplier => ({ value: supplier.id, label: getSupplierLabel(supplier) || supplier.name })),
          ]}
          required
        />
        <FormField dataTestId="purchase-item-input" value={newOrder.item} onChange={(value) => setNewOrder(prev => ({ ...prev, item: value }))} placeholder={t.productName} required />
        <div className="grid grid-cols-3 gap-3">
          <FormField dataTestId="purchase-quantity-input" value={newOrder.quantity} onChange={(value) => setNewOrder(prev => ({ ...prev, quantity: value }))} placeholder={t.quantity} />
          <FormField value={newOrder.unit} onChange={(value) => setNewOrder(prev => ({ ...prev, unit: value }))} placeholder={t.unit} />
          <FormField dataTestId="purchase-price-input" value={newOrder.price} onChange={(value) => setNewOrder(prev => ({ ...prev, price: value }))} placeholder={t.price} />
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/20">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">到岸成本</p>
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
              CNY {purchaseCostPreview.landedUnitCost.toLocaleString()} / {newOrder.unit || t.unit}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              dataTestId="purchase-currency-select"
              as="select"
              value={newOrder.currency}
              onChange={(value) => setNewOrder(prev => ({ ...prev, currency: value, exchangeRate: value === 'CNY' ? '1' : prev.exchangeRate }))}
              options={[
                { value: 'CNY', label: 'CNY' },
                { value: 'USD', label: 'USD' },
                { value: 'VND', label: 'VND' },
              ]}
              inputClassName="bg-white dark:bg-slate-900"
            />
            <FormField dataTestId="purchase-exchange-rate-input" label="汇率" value={newOrder.exchangeRate} onChange={(value) => setNewOrder(prev => ({ ...prev, exchangeRate: value }))} placeholder="1 CNY = X" inputClassName="bg-white dark:bg-slate-900" />
            <FormField dataTestId="purchase-tax-rate-input" label="税率%" value={newOrder.taxRate} onChange={(value) => setNewOrder(prev => ({ ...prev, taxRate: value }))} inputClassName="bg-white dark:bg-slate-900" />
            <FormField dataTestId="purchase-tax-amount-input" label="税额" value={newOrder.taxAmount} onChange={(value) => setNewOrder(prev => ({ ...prev, taxAmount: value }))} placeholder="留空自动按税率" inputClassName="bg-white dark:bg-slate-900" />
            <FormField dataTestId="purchase-freight-cost-input" label="运费(CNY)" value={newOrder.freightCost} onChange={(value) => setNewOrder(prev => ({ ...prev, freightCost: value }))} inputClassName="bg-white dark:bg-slate-900" />
            <FormField dataTestId="purchase-duty-cost-input" label="关税(CNY)" value={newOrder.dutyCost} onChange={(value) => setNewOrder(prev => ({ ...prev, dutyCost: value }))} inputClassName="bg-white dark:bg-slate-900" />
            <FormField dataTestId="purchase-insurance-cost-input" label="保险(CNY)" value={newOrder.insuranceCost} onChange={(value) => setNewOrder(prev => ({ ...prev, insuranceCost: value }))} inputClassName="bg-white dark:bg-slate-900" />
            <FormField dataTestId="purchase-other-cost-input" label="其他(CNY)" value={newOrder.otherCost} onChange={(value) => setNewOrder(prev => ({ ...prev, otherCost: value }))} inputClassName="bg-white dark:bg-slate-900" />
          </div>
          <p className="mt-3 text-[11px] font-bold text-emerald-700/80 dark:text-emerald-300/80">
            预估总到岸成本：CNY {purchaseCostPreview.landedCostAmount.toLocaleString()}
          </p>
        </div>
        <FormField dataTestId="purchase-eta-input" type="date" value={newOrder.eta} onChange={(value) => setNewOrder(prev => ({ ...prev, eta: value }))} />
        <button data-testid="save-purchase-button" onClick={addOrder} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-appLift transition hover:bg-blue-700">{t.savePurchase}</button>
      </div>
    </div>
  </div>
);

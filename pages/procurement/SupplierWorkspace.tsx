import React, { type Dispatch, type SetStateAction } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { EnterpriseDataGrid, FormField, type EnterpriseColumn } from '../../components/ui';
import type { Supplier } from '../../services/procurement.service';
import type { NewSupplierForm, ProcurementFormErrors } from './procurementForms';

type SupplierWorkspaceProps = {
  t: any;
  filteredSuppliers: Supplier[];
  supplierColumns: EnterpriseColumn<Supplier>[];
  supplierSearch: string;
  setSupplierSearch: (value: string) => void;
  isLoading: boolean;
  newSupplier: NewSupplierForm;
  setNewSupplier: Dispatch<SetStateAction<NewSupplierForm>>;
  supplierErrors: ProcurementFormErrors;
  clearSupplierError: (field: string) => void;
  addSupplier: () => void;
  canWrite: boolean;
};

export const SupplierWorkspace = ({
  t,
  filteredSuppliers,
  supplierColumns,
  supplierSearch,
  setSupplierSearch,
  isLoading,
  newSupplier,
  setNewSupplier,
  supplierErrors,
  clearSupplierError,
  addSupplier,
  canWrite,
}: SupplierWorkspaceProps) => {
  const [showAdvancedSupplierFields, setShowAdvancedSupplierFields] = React.useState(false);
  const updateSupplierField = (field: keyof NewSupplierForm, value: string) => {
    clearSupplierError(field);
    setNewSupplier(prev => ({ ...prev, [field]: value }));
  };
  const supplierErrorCount = Object.keys(supplierErrors).length;
  const advancedSummary = [
    newSupplier.nameZh.trim() || newSupplier.nameEn.trim() || newSupplier.nameVi.trim() ? '已填多语言名称' : '',
    newSupplier.addressFullAddress.trim() || newSupplier.addressCity.trim() ? '已填地址' : '',
    newSupplier.rating.trim() ? `评级 ${newSupplier.rating}` : '',
    newSupplier.leadTimeDays.trim() ? `交期 ${newSupplier.leadTimeDays} 天` : '',
  ].filter(Boolean).join(' · ') || '可稍后补充';

  return (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <div className="lg:col-span-8 app-card p-6">
      <section data-testid="procurement-supplier-boundary" className="mb-4 rounded-[28px] border border-blue-100 bg-blue-50/80 p-4 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/30">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-2xl bg-white p-2 text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-300">
            <ShieldCheck size={16} />
          </div>
          <div>
            <h3 className="text-sm font-black tracking-tight text-slate-950 dark:text-white">供应商主数据入口</h3>
            <p className="mt-2 text-xs font-bold leading-6 text-slate-600 dark:text-slate-300">
              这里只维护供应商身份、多语言名称、地址、联系人和风险信息。采购承诺去“采购订单”，真实收货从订单行进入，不在供应商档案里补库存或做应付结算。
            </p>
          </div>
        </div>
      </section>
      <EnterpriseDataGrid
        data={filteredSuppliers}
        columns={supplierColumns}
        rowKey="id"
        title={t.suppliers}
        description={t.supplierAliasPlaceholder}
        searchValue={supplierSearch}
        onSearchChange={setSupplierSearch}
        searchPlaceholder={t.search}
        searchInputTestId="procurement-supplier-search"
        manualSearch
        loading={isLoading}
        emptyTitle={t.noData || '暂无供应商'}
        emptyDescription="请调整搜索条件，或在右侧新增供应商。"
        getRowTestId={(supplier) => `supplier-card-${supplier.id}`}
        defaultPageSize={8}
      />
    </div>

    <div className="lg:col-span-4 app-card flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden p-0 lg:sticky lg:top-6">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 dark:border-slate-800">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t.addSupplier}</h3>
        <Plus size={16} className="text-slate-400" />
      </div>
      {!canWrite ? (
        <div className="m-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm font-bold leading-6 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          当前角色只能查看供应商主数据，新增和修改供应商需要采购写入权限。
        </div>
      ) : (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 pr-4">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-xs font-bold leading-6 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
          先填“供应商名称 + 品类 + 主要联系人”即可建档。多语言名称、地址、评级和交期属于档案完善信息，展开后补齐，避免第一步录入过重。
        </div>
        {supplierErrorCount > 0 && (
          <div data-testid="supplier-form-error-summary" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
            还有 {supplierErrorCount} 项供应商信息需要修正：{Object.values(supplierErrors)[0]}
          </div>
        )}
        <FormField dataTestId="supplier-name-input" label={t.supplierName} value={newSupplier.name} onChange={(value) => updateSupplierField('name', value)} placeholder={t.supplierName} required error={supplierErrors.name} maxLength={120} />
        <FormField dataTestId="supplier-category-input" label={t.category} value={newSupplier.category} onChange={(value) => updateSupplierField('category', value)} placeholder={t.category} required error={supplierErrors.category} maxLength={60} />
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="mb-3 text-xs font-bold text-slate-400">{t.mainContact}</div>
          <div className="space-y-3">
            <FormField dataTestId="supplier-contact-input" value={newSupplier.contact} onChange={(value) => updateSupplierField('contact', value)} placeholder={t.contactName} inputClassName="bg-white dark:bg-slate-900" maxLength={80} />
            <div className="grid grid-cols-2 gap-3">
              <FormField dataTestId="supplier-phone-input" value={newSupplier.contactPhone} onChange={(value) => updateSupplierField('contactPhone', value)} placeholder={t.phone} inputClassName="bg-white dark:bg-slate-900" maxLength={40} />
              <FormField dataTestId="supplier-email-input" value={newSupplier.contactEmail} onChange={(value) => updateSupplierField('contactEmail', value)} placeholder={t.email} error={supplierErrors.contactEmail} inputClassName="bg-white dark:bg-slate-900" maxLength={120} />
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="supplier-toggle-advanced"
          onClick={() => setShowAdvancedSupplierFields(prev => !prev)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-xs font-black text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-blue-950/30"
        >
          {showAdvancedSupplierFields ? '收起高级档案' : '展开高级档案'} · {advancedSummary}
        </button>
        {showAdvancedSupplierFields ? (
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="text-xs font-black text-slate-500 dark:text-slate-300">多语言名称 / 地址 / 风险</div>
            <FormField label={`${t.supplierName}（中文）`} value={newSupplier.nameZh} onChange={(value) => updateSupplierField('nameZh', value)} placeholder={`${t.supplierName}（中文）`} inputClassName="bg-white dark:bg-slate-900" maxLength={120} />
            <FormField label={`${t.supplierName} (English)`} value={newSupplier.nameEn} onChange={(value) => updateSupplierField('nameEn', value)} placeholder={`${t.supplierName} (English)`} inputClassName="bg-white dark:bg-slate-900" maxLength={120} />
            <FormField label={`${t.supplierName} (Tiếng Việt)`} value={newSupplier.nameVi} onChange={(value) => updateSupplierField('nameVi', value)} placeholder={`${t.supplierName} (Tiếng Việt)`} inputClassName="bg-white dark:bg-slate-900" maxLength={120} />
            <FormField label="别名 / 曾用名" as="textarea" value={newSupplier.nameAliases} onChange={(value) => updateSupplierField('nameAliases', value)} placeholder={t.supplierAliasPlaceholder} rows={3} inputClassName="bg-white dark:bg-slate-900" maxLength={500} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-3 text-xs font-bold text-slate-400">{t.mainAddress}</div>
              <div className="space-y-3">
                <FormField dataTestId="supplier-address-label-input" value={newSupplier.addressLabel} onChange={(value) => updateSupplierField('addressLabel', value)} placeholder={t.addressLabel} inputClassName="bg-white dark:bg-slate-900" maxLength={80} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField dataTestId="supplier-country-code-input" value={newSupplier.addressCountryCode} onChange={(value) => updateSupplierField('addressCountryCode', value)} transformValue={(value) => value.toUpperCase()} placeholder={t.countryCode} inputClassName="bg-white uppercase dark:bg-slate-900" maxLength={3} />
                  <FormField dataTestId="supplier-city-input" value={newSupplier.addressCity} onChange={(value) => updateSupplierField('addressCity', value)} placeholder={t.city} inputClassName="bg-white dark:bg-slate-900" maxLength={80} />
                </div>
                <FormField dataTestId="supplier-full-address-input" as="textarea" value={newSupplier.addressFullAddress} onChange={(value) => updateSupplierField('addressFullAddress', value)} placeholder={t.fullAddress} rows={3} inputClassName="bg-white dark:bg-slate-900" maxLength={500} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t.rating} value={newSupplier.rating} onChange={(value) => updateSupplierField('rating', value)} placeholder={t.rating} error={supplierErrors.rating} inputClassName="bg-white dark:bg-slate-900" />
              <FormField label={t.leadTime} value={newSupplier.leadTimeDays} onChange={(value) => updateSupplierField('leadTimeDays', value)} placeholder={t.leadTime} error={supplierErrors.leadTimeDays} inputClassName="bg-white dark:bg-slate-900" />
            </div>
            <FormField
              label="风险等级"
              as="select"
              value={newSupplier.riskLevel}
              onChange={(value) => updateSupplierField('riskLevel', value)}
              inputClassName="bg-white dark:bg-slate-900"
              options={[
                { value: 'low', label: t.riskLow },
                { value: 'medium', label: t.riskMedium },
                { value: 'high', label: t.riskHigh },
              ]}
            />
          </div>
        ) : null}
      </div>
      )}
      <div className="border-t border-slate-100 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button data-testid="save-supplier-button" onClick={addSupplier} disabled={!canWrite} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-appLift transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{t.saveSupplier}</button>
      </div>
    </div>
  </div>
  );
};

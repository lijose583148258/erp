import React, { type Dispatch, type SetStateAction } from 'react';
import { Plus } from 'lucide-react';
import { EnterpriseDataGrid, FormField, type EnterpriseColumn } from '../../components/ui';
import type { Supplier } from '../../services/procurement.service';
import type { NewSupplierForm } from './procurementForms';

type SupplierWorkspaceProps = {
  t: any;
  filteredSuppliers: Supplier[];
  supplierColumns: EnterpriseColumn<Supplier>[];
  supplierSearch: string;
  setSupplierSearch: (value: string) => void;
  isLoading: boolean;
  newSupplier: NewSupplierForm;
  setNewSupplier: Dispatch<SetStateAction<NewSupplierForm>>;
  addSupplier: () => void;
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
  addSupplier,
}: SupplierWorkspaceProps) => (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <div className="lg:col-span-8 app-card p-6">
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
        emptyDescription={t.search || '请调整搜索条件，或在右侧新增供应商。'}
        getRowTestId={(supplier) => `supplier-card-${supplier.id}`}
        defaultPageSize={8}
      />
    </div>

    <div className="lg:col-span-4 app-card flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden p-0 lg:sticky lg:top-6">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 dark:border-slate-800">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t.addSupplier}</h3>
        <Plus size={16} className="text-slate-400" />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 pr-4">
        <FormField dataTestId="supplier-name-input" label={t.supplierName} value={newSupplier.name} onChange={(value) => setNewSupplier(prev => ({ ...prev, name: value }))} placeholder={t.supplierName} required />
        <FormField label={`${t.supplierName}（中文）`} value={newSupplier.nameZh} onChange={(value) => setNewSupplier(prev => ({ ...prev, nameZh: value }))} placeholder={`${t.supplierName}（中文）`} />
        <FormField label={`${t.supplierName} (English)`} value={newSupplier.nameEn} onChange={(value) => setNewSupplier(prev => ({ ...prev, nameEn: value }))} placeholder={`${t.supplierName} (English)`} />
        <FormField label={`${t.supplierName} (Tiếng Việt)`} value={newSupplier.nameVi} onChange={(value) => setNewSupplier(prev => ({ ...prev, nameVi: value }))} placeholder={`${t.supplierName} (Tiếng Việt)`} />
        <FormField as="textarea" value={newSupplier.nameAliases} onChange={(value) => setNewSupplier(prev => ({ ...prev, nameAliases: value }))} placeholder={t.supplierAliasPlaceholder} rows={3} />
        <FormField dataTestId="supplier-category-input" label={t.category} value={newSupplier.category} onChange={(value) => setNewSupplier(prev => ({ ...prev, category: value }))} placeholder={t.category} required />
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="mb-3 text-xs font-bold text-slate-400">{t.mainContact}</div>
          <div className="space-y-3">
            <FormField dataTestId="supplier-contact-input" value={newSupplier.contact} onChange={(value) => setNewSupplier(prev => ({ ...prev, contact: value }))} placeholder={t.contactName} inputClassName="bg-white dark:bg-slate-900" />
            <div className="grid grid-cols-2 gap-3">
              <FormField dataTestId="supplier-phone-input" value={newSupplier.contactPhone} onChange={(value) => setNewSupplier(prev => ({ ...prev, contactPhone: value }))} placeholder={t.phone} inputClassName="bg-white dark:bg-slate-900" />
              <FormField dataTestId="supplier-email-input" value={newSupplier.contactEmail} onChange={(value) => setNewSupplier(prev => ({ ...prev, contactEmail: value }))} placeholder={t.email} inputClassName="bg-white dark:bg-slate-900" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="mb-3 text-xs font-bold text-slate-400">{t.mainAddress}</div>
          <div className="space-y-3">
            <FormField dataTestId="supplier-address-label-input" value={newSupplier.addressLabel} onChange={(value) => setNewSupplier(prev => ({ ...prev, addressLabel: value }))} placeholder={t.addressLabel} inputClassName="bg-white dark:bg-slate-900" />
            <div className="grid grid-cols-2 gap-3">
              <FormField dataTestId="supplier-country-code-input" value={newSupplier.addressCountryCode} onChange={(value) => setNewSupplier(prev => ({ ...prev, addressCountryCode: value }))} transformValue={(value) => value.toUpperCase()} placeholder={t.countryCode} inputClassName="bg-white uppercase dark:bg-slate-900" />
              <FormField dataTestId="supplier-city-input" value={newSupplier.addressCity} onChange={(value) => setNewSupplier(prev => ({ ...prev, addressCity: value }))} placeholder={t.city} inputClassName="bg-white dark:bg-slate-900" />
            </div>
            <FormField dataTestId="supplier-full-address-input" as="textarea" value={newSupplier.addressFullAddress} onChange={(value) => setNewSupplier(prev => ({ ...prev, addressFullAddress: value }))} placeholder={t.fullAddress} rows={3} inputClassName="bg-white dark:bg-slate-900" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField value={newSupplier.rating} onChange={(value) => setNewSupplier(prev => ({ ...prev, rating: value }))} placeholder={t.rating} />
          <FormField value={newSupplier.leadTimeDays} onChange={(value) => setNewSupplier(prev => ({ ...prev, leadTimeDays: value }))} placeholder={t.leadTime} />
        </div>
        <FormField
          as="select"
          value={newSupplier.riskLevel}
          onChange={(value) => setNewSupplier(prev => ({ ...prev, riskLevel: value }))}
          options={[
            { value: 'low', label: t.riskLow },
            { value: 'medium', label: t.riskMedium },
            { value: 'high', label: t.riskHigh },
          ]}
        />
      </div>
      <div className="border-t border-slate-100 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button data-testid="save-supplier-button" onClick={addSupplier} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-appLift transition hover:bg-blue-700">{t.saveSupplier}</button>
      </div>
    </div>
  </div>
);

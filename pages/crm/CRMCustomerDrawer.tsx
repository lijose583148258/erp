import React from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Contact, CurrentUser, Customer, CustomerAddress, CustomerPoolHistoryEntry, TeamMember } from '../../types';
import { getCustomerDisplayNames } from '../../utils/customerName';
import { getCustomerPoolState } from '../../utils/customerPool';
import {
  CRMCustomerAddressesSection,
  CRMCustomerAuditSection,
  CRMCustomerContactsSection,
  CRMCustomerMasterProfileSection,
  CRMCustomerOwnershipSection,
  type PoolHistorySummary,
  type TranslationText,
} from './CRMCustomerDrawerSections';

type Props = {
  t: TranslationText;
  formatPrice: (value: number) => string;
  selectedCustomer: Customer;
  aiInsight: string | null;
  loadingAi: boolean;
  onClose: () => void;
  onUploadLicense: (e: React.ChangeEvent<HTMLInputElement>) => void;
  licenseInputRef: React.RefObject<HTMLInputElement>;
  onAddContact: () => void;
  onUpdateContact: <K extends keyof Contact>(idx: number, field: K, value: Contact[K]) => void;
  onAddAddress: () => void;
  onUpdateAddress: <K extends keyof CustomerAddress>(idx: number, field: K, value: CustomerAddress[K]) => void;
  onUpdateProfileMeta: (patch: Partial<Pick<Customer, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'nameAliases' | 'notes'>>) => void;
  onFetchAiInsight: (customer: Customer) => void;
  currentUser: CurrentUser;
  canEditProfile: boolean;
  poolReason: string;
  setPoolReason: (value: string) => void;
  poolSalespersonId: string;
  setPoolSalespersonId: (value: string) => void;
  isPoolUpdating: boolean;
  onPoolAction: (poolState: 'public' | 'internal' | 'private') => void;
  poolHistory: CustomerPoolHistoryEntry[];
  poolHistoryLatest: CustomerPoolHistoryEntry | null;
  poolHistorySummary: PoolHistorySummary;
  loadingPoolHistory: boolean;
  salesAssignees: TeamMember[];
};

export function CRMCustomerDrawer({
  t,
  formatPrice,
  selectedCustomer,
  aiInsight,
  loadingAi,
  onClose,
  onUploadLicense,
  licenseInputRef,
  onAddContact,
  onUpdateContact,
  onAddAddress,
  onUpdateAddress,
  onUpdateProfileMeta,
  onFetchAiInsight,
  currentUser,
  canEditProfile,
  poolReason,
  setPoolReason,
  poolSalespersonId,
  setPoolSalespersonId,
  isPoolUpdating,
  onPoolAction,
  poolHistory,
  poolHistoryLatest,
  poolHistorySummary,
  loadingPoolHistory,
  salesAssignees,
}: Props) {
  const canManagePool = currentUser.role === 'manager' || currentUser.role === 'admin';
  const currentPoolState = getCustomerPoolState(selectedCustomer);
  const customerNames = getCustomerDisplayNames(selectedCustomer);
  const addresses = selectedCustomer.addresses || [];
  const contacts = selectedCustomer.contacts || [];
  const primaryAddress = addresses.find((address) => address.isPrimary) || addresses[0] || null;
  const primaryContact = contacts.find((contact) => contact.isPrimary) || contacts[0] || null;
  const readOnlyProfile = !canEditProfile;
  const aliasEditorValue = (selectedCustomer.nameAliases || []).join('\n');

  return (
    <div data-testid="crm-customer-drawer" className="fixed inset-0 z-[80] flex justify-end bg-slate-900/30 backdrop-blur-sm lg:static lg:z-auto lg:w-[540px] lg:bg-transparent lg:backdrop-blur-none">
      <div className="flex h-full w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 lg:max-h-[88vh] lg:rounded-[40px] lg:border">
        <div className="border-b border-slate-100 px-8 py-6 dark:border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <button onClick={onClose} className="mb-4 flex items-center text-sm font-bold text-slate-500 lg:hidden">
                <ArrowLeft size={18} className="mr-2" />返回
              </button>
              <div className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-500">{t.crmCustomer360 || 'Customer 360'}</div>
              <h4 className="mt-2 text-2xl font-black italic tracking-tight text-slate-900 dark:text-white">
                {selectedCustomer.displayName || selectedCustomer.name}
              </h4>
              <div className="mt-3 space-y-1 text-[11px] font-bold text-slate-500">
                {customerNames.zh && <div>中文名：{customerNames.zh}</div>}
                {customerNames.en && <div>English：{customerNames.en}</div>}
                {customerNames.vi && <div>Tiếng Việt：{customerNames.vi}</div>}
                {customerNames.aliases.length > 0 && <div>别名：{customerNames.aliases.join(' / ')}</div>}
              </div>
            </div>
            <button onClick={onClose} className="hidden rounded-full bg-slate-100 p-3 text-slate-500 transition hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 lg:block">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-8 py-8 pb-28 lg:pb-8">
          <CRMCustomerMasterProfileSection
            t={t}
            formatPrice={formatPrice}
            selectedCustomer={selectedCustomer}
            currentPoolState={currentPoolState}
            customerNames={customerNames}
            primaryAddress={primaryAddress}
            primaryContact={primaryContact}
            readOnlyProfile={readOnlyProfile}
            canEditProfile={canEditProfile}
            aliasEditorValue={aliasEditorValue}
            onUpdateProfileMeta={onUpdateProfileMeta}
            onUploadLicense={onUploadLicense}
            licenseInputRef={licenseInputRef}
          />
          <CRMCustomerOwnershipSection
            t={t}
            currentPoolState={currentPoolState}
            canManagePool={canManagePool}
            poolReason={poolReason}
            setPoolReason={setPoolReason}
            poolSalespersonId={poolSalespersonId}
            setPoolSalespersonId={setPoolSalespersonId}
            isPoolUpdating={isPoolUpdating}
            onPoolAction={onPoolAction}
            poolHistorySummary={poolHistorySummary}
            salesAssignees={salesAssignees}
          />
          <CRMCustomerAddressesSection
            t={t}
            addresses={addresses}
            readOnlyProfile={readOnlyProfile}
            onAddAddress={onAddAddress}
            onUpdateAddress={onUpdateAddress}
          />
          <CRMCustomerContactsSection
            t={t}
            contacts={contacts}
            readOnlyProfile={readOnlyProfile}
            onAddContact={onAddContact}
            onUpdateContact={onUpdateContact}
          />
          <CRMCustomerAuditSection
            t={t}
            selectedCustomer={selectedCustomer}
            aiInsight={aiInsight}
            loadingAi={loadingAi}
            onFetchAiInsight={onFetchAiInsight}
            poolHistory={poolHistory}
            poolHistoryLatest={poolHistoryLatest}
            poolHistorySummary={poolHistorySummary}
            loadingPoolHistory={loadingPoolHistory}
          />
        </div>
      </div>
    </div>
  );
}

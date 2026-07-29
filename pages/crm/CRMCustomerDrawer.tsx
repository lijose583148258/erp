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
  licenseInputRef: React.RefObject<HTMLInputElement | null>;
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

type CustomerDetailSection = 'master' | 'addresses' | 'contacts' | 'ownership' | 'audit';

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
  const [activeSection, setActiveSection] = React.useState<CustomerDetailSection>('master');

  React.useEffect(() => {
    setActiveSection('master');
  }, [selectedCustomer.id]);

  const detailSections: { id: CustomerDetailSection; label: string; hint: string }[] = [
    { id: 'master', label: t.crmMasterProfileTitle || '主数据', hint: t.crmMasterProfile || 'Master' },
    { id: 'addresses', label: t.crmAddressesTitle || '地址', hint: `${addresses.length}` },
    { id: 'contacts', label: t.crmContactsTitle || '联系人', hint: `${contacts.length}` },
    { id: 'ownership', label: t.crmOwnershipTitle || '归属池', hint: t.crmCustomerPool || 'Pool' },
    { id: 'audit', label: t.crmAuditTitle || '审计', hint: t.crmPoolAuditTitle || 'Audit' },
  ];

  return (
    <div data-testid="crm-customer-drawer" className="fixed inset-0 z-[80] flex justify-end bg-slate-900/30 backdrop-blur-sm lg:static lg:z-auto lg:w-[540px] lg:bg-transparent lg:backdrop-blur-none">
      <div className="flex h-full w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 lg:max-h-[88vh] lg:rounded-[40px] lg:border">
        <div className="border-b border-slate-100 px-8 py-6 dark:border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <button onClick={onClose} className="mb-4 flex items-center text-sm font-bold text-slate-500 lg:hidden">
                <ArrowLeft size={18} className="mr-2" />返回
              </button>
              <div className="text-xs font-black uppercase tracking-[0.28em] text-blue-500">{t.crmCustomer360 || 'Customer 360'}</div>
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
          <div data-testid="crm-customer-detail-nav" className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
            {detailSections.map((section) => {
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  data-testid={`crm-customer-detail-nav-${section.id}`}
                  onClick={() => setActiveSection(section.id)}
                  className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                    active
                      ? 'border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                      : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-blue-200 hover:bg-white hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  <div className="text-xs font-black tracking-tight">{section.label}</div>
                  <div className={`mt-1 text-xs font-black uppercase tracking-[0.16em] ${active ? 'text-blue-100' : 'text-slate-400'}`}>{section.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-8 py-8 pb-28 lg:pb-8">
          {activeSection === 'master' && (
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
          )}
          {activeSection === 'addresses' && (
            <CRMCustomerAddressesSection
              t={t}
              addresses={addresses}
              readOnlyProfile={readOnlyProfile}
              onAddAddress={onAddAddress}
              onUpdateAddress={onUpdateAddress}
            />
          )}
          {activeSection === 'contacts' && (
            <CRMCustomerContactsSection
              t={t}
              contacts={contacts}
              readOnlyProfile={readOnlyProfile}
              onAddContact={onAddContact}
              onUpdateContact={onUpdateContact}
            />
          )}
          {activeSection === 'ownership' && (
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
          )}
          {activeSection === 'audit' && (
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
          )}
        </div>
      </div>
    </div>
  );
}

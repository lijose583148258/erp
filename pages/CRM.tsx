
import React from 'react';
import DataTable from '../components/DataTable';
import { useCRM } from './crm/useCRM';
import { CRMPageShell } from './crm/CRMPageShell';
import { CRMViewSwitcher } from './crm/CRMViewSwitcher';
import { CRMWorkbenchStats } from './crm/CRMWorkbenchStats';
import { CRMCustomerDrawer } from './crm/CRMCustomerDrawer';
import { CRMCreateModal } from './crm/CRMCreateModal';

const CRM = () => {
  const crm = useCRM();

  return (
    <div className="space-y-6">
      <CRMPageShell title={crm.t.crmTitle} subtitle={crm.t.crmSub}>
        <CRMViewSwitcher
          t={crm.t}
          viewMode={crm.viewMode}
          onViewChange={crm.setViewMode}
          segmentFilter={crm.segmentFilter}
          onSegmentChange={crm.setSegmentFilter}
          searchKeyword={crm.searchKeyword}
          onSearchKeywordChange={crm.setSearchKeyword}
          onCreate={() => crm.setIsCreateOpen(true)}
          scopeSegment={crm.managerSegmentScope}
          canCreate={crm.canCreateCustomer}
        />
      </CRMPageShell>

      <CRMWorkbenchStats
        scopeSegment={crm.managerSegmentScope}
        stats={crm.scopeStats}
        segmentBreakdown={crm.segmentBreakdown}
        formatPrice={crm.formatPrice}
      />

      <div className="flex flex-col lg:flex-row gap-8 relative">
        <div className="flex-1 min-w-0">
          <DataTable
          title={crm.viewMode === 'public' ? crm.t.publicPool : crm.t.myCustomers}
          columns={crm.columns}
          data={crm.filteredData}
          onImport={crm.canImportCustomer ? crm.handleImport : undefined}
          rowTestId={(row) => `crm-customer-row-${row.id}`}
          onRowClick={(row) => { crm.setSelectedCustomer(row); }}
        />
        </div>

        {crm.selectedCustomer && (
          <CRMCustomerDrawer
            t={crm.t}
            formatPrice={crm.formatPrice}
            selectedCustomer={crm.selectedCustomer}
            aiInsight={crm.aiInsight}
            loadingAi={crm.loadingAi}
            onClose={() => crm.setSelectedCustomer(null)}
            onUploadLicense={crm.handleLicenseUpload}
            licenseInputRef={crm.licenseInputRef}
            onAddContact={crm.handleAddContact}
            onUpdateContact={crm.updateContact}
            onAddAddress={crm.handleAddAddress}
            onUpdateAddress={crm.updateAddress}
            onFetchAiInsight={crm.fetchAiInsight}
            onUpdateProfileMeta={crm.handleUpdateCustomerMeta}
            currentUser={crm.currentUser}
            canEditProfile={crm.canEditSelectedCustomer}
            poolReason={crm.poolReason}
            setPoolReason={crm.setPoolReason}
            poolSalespersonId={crm.poolSalespersonId}
            setPoolSalespersonId={crm.setPoolSalespersonId}
            isPoolUpdating={crm.isPoolUpdating}
            onPoolAction={crm.handlePoolAction}
            poolHistory={crm.poolHistory}
            poolHistoryLatest={crm.poolHistoryLatest}
            poolHistorySummary={crm.poolHistorySummary}
            loadingPoolHistory={crm.loadingPoolHistory}
            salesAssignees={crm.salesAssignees}
          />
        )}

        {crm.isCreateOpen && (
          <CRMCreateModal
            t={crm.t}
            isSubmitting={crm.isSubmitting}
            newCustomer={crm.newCustomer}
            setNewCustomer={crm.setNewCustomer}
            onCreate={crm.handleCreateCustomer}
            onClose={() => crm.setIsCreateOpen(false)}
            lockedSegment={crm.managerSegmentScope}
          />
        )}
      </div>
    </div>
  );
};

export default CRM;

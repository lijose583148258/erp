
import React from 'react';
import DataTable from '../components/DataTable';
import { useAppContext } from '../app/AppContext';
import { DocumentInputGuide } from '../components/ui/DocumentInputGuide';
import { getModuleDescription, getModuleTitle } from '../components/navigation/moduleRegistry';
import { useCRM } from './crm/useCRM';
import { CRMPageShell } from './crm/CRMPageShell';
import { CRMViewSwitcher } from './crm/CRMViewSwitcher';
import { CRMWorkbenchStats } from './crm/CRMWorkbenchStats';
import { CRMCustomerDrawer } from './crm/CRMCustomerDrawer';
import { CRMCreateModal } from './crm/CRMCreateModal';

const CRM = () => {
  const crm = useCRM();
  const { language } = useAppContext();

  return (
    <div className="space-y-6">
      <DocumentInputGuide
        testId="crm-input-guide"
        eyebrow="客户主数据 / 归属池路线"
        title="先找客户，再决定建档、分配、跟进或审计"
        description="客户档案不是一张简单名片。跨国公司可能同时有中文名、越南名、英文名，也可能有法定地址、发货地址、账单地址和多个联系人。这里先搜索确认是否已有主数据，再做新增、归属池分配、联系人和地址维护，避免重复建档和客户池混乱。"
        tone="blue"
        steps={[
          { title: '先搜索', description: '按中文名、越南名、英文名、税号、联系人搜索，确认不是重复客户。', badge: '查重' },
          { title: '再建档', description: '简版先录核心信息，高级字段再补多名称、多地址、多联系人。', badge: '主数据' },
          { title: '定归属', description: '区分公海、内池、私海、分配、收回，避免业务员误看或误改。', badge: '权限' },
          { title: '看审计', description: '客户修改、分配、释放、信用变更都要留下记录。', badge: '追溯' },
        ]}
        boundaries={[
          { title: '本区负责', items: ['客户主数据', '多名称', '多地址', '多联系人', '客户池归属'] },
          { title: '不要在本区完成', items: ['真实回款核验', '发货出库', '生产完工', '采购收货'] },
        ]}
        evidence={['列表能查到', '详情能回读', '归属池正确', '审计可追溯']}
      />
      <CRMPageShell title={getModuleTitle('crm', language)} subtitle={getModuleDescription('crm', language)}>
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
          onImport={crm.canImportCustomer ? (rows) => { void crm.handleImport(rows as any[]); } : undefined}
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

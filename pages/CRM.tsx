
import React from 'react';
import DataTable from '../components/DataTable';
import { useAppContext } from '../app/AppContext';
import { getModuleDescription, getModuleTitle } from '../components/navigation/moduleRegistry';
import { useCRM } from './crm/useCRM';
import { CRMPageShell } from './crm/CRMPageShell';
import { CRMViewSwitcher } from './crm/CRMViewSwitcher';
import { CRMWorkbenchStats } from './crm/CRMWorkbenchStats';
import { CRMCustomerDrawer } from './crm/CRMCustomerDrawer';
import { CRMCreateModal } from './crm/CRMCreateModal';
import { DocumentInputGuide } from '../components/ui/DocumentInputGuide';

const crmGuideCopy = {
  zh: {
    eyebrow: '客户主数据',
    title: '先建客户档案，再维护地址、联系人和归属',
    description: '客户页只处理客户主数据和客户池归属；订单、发货、回款在各自业务单据中处理。新建后从列表回读客户，再进入右侧抽屉补地址、联系人、证照和风险信息。',
    steps: [
      { title: '新建档案', description: '至少填写一个客户名称，支持中英越名称、别名和分销/内销分段。', badge: '档案' },
      { title: '补充资料', description: '在抽屉维护多联系人、多地址、证照、账期和风险等级。', badge: '资料' },
      { title: '分配归属', description: '管理员或经理通过客户池动作分配销售归属，并留下原因。', badge: '归属' },
      { title: '列表回读', description: '保存后回到客户列表核对名称、分段、联系人和地址是否完整。', badge: '回读' },
    ],
    evidence: ['列表能搜索到', '抽屉能打开', '地址联系人可回读', '客户池历史可追踪'],
  },
  en: {
    eyebrow: 'Customer master data',
    title: 'Create the account first, then maintain addresses, contacts, and ownership',
    description: 'This page owns customer master data and pool assignment only. Orders, delivery, and collection stay in their own documents. After creation, read the customer back from the list before completing addresses, contacts, licenses, and risk details.',
    steps: [
      { title: 'Create record', description: 'Enter at least one customer name, with CN/EN/VI names, aliases, and sales segment.', badge: 'Record' },
      { title: 'Complete data', description: 'Use the drawer for contacts, addresses, license, terms, and risk level.', badge: 'Data' },
      { title: 'Assign owner', description: 'Admins or managers assign pool ownership with an auditable reason.', badge: 'Owner' },
      { title: 'Read back', description: 'Return to the list and verify name, segment, contacts, and addresses.', badge: 'Check' },
    ],
    evidence: ['Visible in list', 'Drawer opens', 'Contacts and addresses read back', 'Pool history traceable'],
  },
  vi: {
    eyebrow: 'Du lieu khach hang',
    title: 'Tao ho so truoc, sau do cap nhat dia chi, lien he va phan quyen so huu',
    description: 'Trang nay chi quan ly du lieu khach hang va phan bo nhom khach. Don hang, giao hang va thu tien duoc xu ly o chung tu rieng. Sau khi tao, doc lai khach hang tu danh sach roi bo sung dia chi, lien he, giay phep va rui ro.',
    steps: [
      { title: 'Tao ho so', description: 'Can it nhat mot ten khach hang, ho tro ten CN/EN/VI, bi danh va phan nhom.', badge: 'Ho so' },
      { title: 'Bo sung du lieu', description: 'Dung khung ben phai de cap nhat lien he, dia chi, giay phep, dieu khoan va rui ro.', badge: 'Du lieu' },
      { title: 'Gan phu trach', description: 'Quan tri hoac quan ly gan so huu khach hang kem ly do.', badge: 'So huu' },
      { title: 'Doc lai', description: 'Quay lai danh sach de kiem tra ten, phan nhom, lien he va dia chi.', badge: 'Kiem tra' },
    ],
    evidence: ['Tim thay trong danh sach', 'Mo duoc khung chi tiet', 'Doc lai lien he va dia chi', 'Lich su nhom co dau vet'],
  },
};

const CRM = () => {
  const crm = useCRM();
  const { language } = useAppContext();
  const guide = crmGuideCopy[language] || crmGuideCopy.zh;

  return (
    <div className="space-y-6">
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

      <DocumentInputGuide
        testId="crm-master-data-guide"
        tone="blue"
        eyebrow={guide.eyebrow}
        title={guide.title}
        description={guide.description}
        steps={guide.steps}
        evidence={guide.evidence}
        boundaries={[
          { title: language === 'zh' ? '这里负责' : language === 'vi' ? 'Trang nay phu trach' : 'Owned here', items: guide.evidence.slice(0, 3) },
          { title: language === 'zh' ? '不要混入' : language === 'vi' ? 'Khong xu ly tai day' : 'Kept outside', items: language === 'zh' ? ['订单审批', '发货扣库', '回款核销'] : language === 'vi' ? ['Duyet don hang', 'Tru kho giao hang', 'Doi soat thu tien'] : ['Order approval', 'Shipment stock posting', 'Payment verification'] },
        ]}
      />

      <div className="flex flex-col lg:flex-row gap-8 relative">
        <div className="flex-1 min-w-0">
          <DataTable
          tableId="crm-customers"
          title={crm.viewMode === 'public' ? crm.t.publicPool : crm.t.myCustomers}
          columns={crm.columns}
          data={crm.filteredData}
          isLoading={crm.isLoading}
          hideSearch
          pagination={{
            page: crm.currentPage,
            pageSize: crm.pageSize,
            total: crm.totalCustomers,
            totalPages: crm.totalPages,
            onPageChange: crm.setCurrentPage,
          }}
          onImport={crm.canImportCustomer ? (rows) => { void crm.handleImport(rows as any[]); } : undefined}
          onExport={crm.handleExport}
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

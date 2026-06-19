import { WarehouseWorkspaceGuidance, type WarehouseTabCounts } from './WarehouseWorkspaceGuidance';
import { WarehouseWorkspaceHeader } from './WarehouseWorkspaceHeader';
import { WarehouseWorkspaceSummaryCards } from './WarehouseWorkspaceSummaryCards';
import type { TabKey } from './warehouseWorkspaceTypes';

type WarehouseWorkspaceTopProps = {
  title: string;
  description: string;
  loading: boolean;
  activeTab: TabKey;
  canWrite: boolean;
  canViewLedger: boolean;
  counts: WarehouseTabCounts;
  totalItems: number;
  totalQuantity: number;
  totalLocations: number;
  onRefresh: () => void;
  onCreateWarehouse: () => void;
  onTabChange: (tab: TabKey) => void;
};

export const WarehouseWorkspaceTop = ({
  title,
  description,
  loading,
  activeTab,
  canWrite,
  canViewLedger,
  counts,
  totalItems,
  totalQuantity,
  totalLocations,
  onRefresh,
  onCreateWarehouse,
  onTabChange,
}: WarehouseWorkspaceTopProps) => (
  <>
    <WarehouseWorkspaceHeader
      title={title}
      description={description}
      loading={loading}
      showCreate={activeTab === 'overview'}
      canWrite={canWrite}
      onRefresh={onRefresh}
      onCreate={onCreateWarehouse}
    />

    <WarehouseWorkspaceSummaryCards
      warehouseCount={counts.warehouses}
      totalLocations={totalLocations}
      totalItems={totalItems}
      totalQuantity={totalQuantity}
    />

    <WarehouseWorkspaceGuidance
      activeTab={activeTab}
      canViewLedger={canViewLedger}
      counts={counts}
      onTabChange={onTabChange}
    />
  </>
);

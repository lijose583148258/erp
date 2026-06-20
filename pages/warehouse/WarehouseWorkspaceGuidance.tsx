import { DocumentInputGuide } from '../../components/ui/DocumentInputGuide';
import { WorkspaceTaskNavigator } from '../../components/ui/WorkspaceTaskNavigator';
import {
  warehouseInputGuideBoundaries,
  warehouseInputGuideSteps,
} from './warehouseWorkspaceContent';
import { buildWarehouseTabs } from './warehouseWorkspaceNavigation';
import type { TabKey } from './warehouseWorkspaceTypes';

export type WarehouseTabCounts = {
  warehouses: number;
  stockBalances: number;
  stockTotal: number;
  stockEntries: number;
  locations: number;
};

type WarehouseWorkspaceGuidanceProps = {
  activeTab: TabKey;
  canViewLedger: boolean;
  counts: WarehouseTabCounts;
  onTabChange: (tab: TabKey) => void;
};

export const WarehouseWorkspaceGuidance = ({
  activeTab,
  canViewLedger,
  counts,
  onTabChange,
}: WarehouseWorkspaceGuidanceProps) => {
  const warehouseTabs = buildWarehouseTabs(counts, canViewLedger);

  return (
    <>
      <DocumentInputGuide
        testId="warehouse-complex-input-guide"
        tone="amber"
        eyebrow="仓储复杂输入路径"
        title="仓库 / 库位主档 + 库存台账 + 入库 / 调拨动作 + 回读证据"
        description="先把仓库和库位主档维护清楚，再在库存台账确认余额；所有写库存的动作必须通过受控入口发起，保存后回到库存流水按来源单号、产品、批次、库位核对。"
        steps={warehouseInputGuideSteps}
        boundaries={warehouseInputGuideBoundaries}
        evidence={['库存余额刷新', '库存流水 sourceRef', '调拨双边记录', '负库存拦截']}
      />

      <WorkspaceTaskNavigator
        eyebrow="仓储职责导航"
        title="先确定位置，再看余额，再追流水"
        description="仓储页按成熟库存系统拆成“库位主数据 / 库存余额 / 库存流水 / 应急补录”。同一块区域不再同时承担建仓、查库存、调拨和补录。"
        items={warehouseTabs}
        activeId={activeTab}
        onChange={onTabChange}
        variant="amber"
        columns="four"
      />
    </>
  );
};

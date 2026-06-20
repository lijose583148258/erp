import { History, Layers, Package, Plus } from 'lucide-react';
import type { WorkspaceTaskNavigatorItem } from '../../components/ui/WorkspaceTaskNavigator';
import type { TabKey } from './warehouseWorkspaceTypes';

type WarehouseTabCounts = {
  warehouses: number;
  stockBalances: number;
  stockTotal: number;
  stockEntries: number;
  locations: number;
};

export const buildWarehouseTabs = (
  counts: WarehouseTabCounts,
  canViewLedger: boolean,
): WorkspaceTaskNavigatorItem<TabKey>[] => [
  {
    id: 'overview',
    title: '仓库库位',
    subtitle: '维护仓库和库位主数据',
    purpose: '只回答“货应该放在哪个仓库、哪个库位”。',
    icon: Layers,
    count: counts.warehouses,
    testId: 'warehouse-tab-overview',
  },
  {
    id: 'inventory',
    title: '库存余额',
    subtitle: '查询当前库存和发起库内调拨',
    purpose: '只回答“现在还有多少、在哪个库位”。',
    icon: Package,
    count: counts.stockTotal || counts.stockBalances,
    testId: 'warehouse-tab-inventory',
  },
  ...(canViewLedger ? [{
    id: 'ledger' as const,
    title: '库存流水',
    subtitle: '只读回放入库、出库、调拨和调整',
    purpose: '只回答“库存为什么变成现在这样”。',
    icon: History,
    count: counts.stockEntries,
    testId: 'warehouse-tab-ledger',
  }] : []),
  {
    id: 'inbound',
    title: '应急补录 / 盘盈入库',
    subtitle: '仅用于盘盈、应急补录等受控场景',
    purpose: '不能代替采购收货、生产入库、货抵入库；业务来源入库请回到对应模块办理。',
    icon: Plus,
    count: counts.locations,
    testId: 'warehouse-tab-inbound',
  },
];

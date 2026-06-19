import { getModuleDescription, getModuleTitle } from '../../components/navigation/moduleRegistry';
import { WorkspaceTaskNavigator } from '../../components/ui/WorkspaceTaskNavigator';
import { ProductionWorkspaceHeader, type ProductionWorkspaceStats } from './ProductionWorkspaceHeader';
import type { ProductionDeskTab } from './productionWorkspaceConfig';
import type { WorkspaceTaskNavigatorItem } from '../../components/ui/WorkspaceTaskNavigator';
import type { Language } from '../../types';

type ProductionWorkspaceShellHeaderProps = {
  language: Language;
  stats: ProductionWorkspaceStats;
  isInitialLoading: boolean;
  items: WorkspaceTaskNavigatorItem<ProductionDeskTab>[];
  activeTab: ProductionDeskTab;
  onRefresh: () => void;
  onTabChange: (tab: ProductionDeskTab) => void;
};

export const ProductionWorkspaceShellHeader = ({
  language,
  stats,
  isInitialLoading,
  items,
  activeTab,
  onRefresh,
  onTabChange,
}: ProductionWorkspaceShellHeaderProps) => (
  <>
    <ProductionWorkspaceHeader
      title={getModuleTitle('production', language)}
      description={getModuleDescription('production', language)}
      stats={stats}
      isInitialLoading={isInitialLoading}
      onRefresh={onRefresh}
    />

    <WorkspaceTaskNavigator
      eyebrow="生产职责导航"
      title="先选工作区，再输入数据"
      description="按成熟 ERP 的“对象库 / 执行动作 / 台账回放”拆开：BOM 只管配方，工单只管执行，批次区只做追溯和异常登记，避免同一页面同时承担建档、排产、调账和入库。"
      items={items}
      activeId={activeTab}
      onChange={(id) => {
        if (id === 'bom' || id === 'workOrders' || id === 'batches') onTabChange(id);
      }}
      variant="blue"
    />
  </>
);

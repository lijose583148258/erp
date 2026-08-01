import { ArrowUpRight, Factory, Layers3, PackageCheck, Play, ScanBarcode, TriangleAlert } from 'lucide-react';
import { StatCard } from './ProductionWorkspacePrimitives';

export type ProductionWorkspaceStats = {
  totalBoms: number;
  totalWorkOrders: number;
  activeWorkOrders: number;
  qcPendingCount: number;
  batchCount: number;
  totalStock: number;
};

type ProductionWorkspaceHeaderProps = {
  title: string;
  description: string;
  stats: ProductionWorkspaceStats;
  isInitialLoading: boolean;
  onRefresh: () => void;
};

export const ProductionWorkspaceHeader = ({
  title,
  description,
  stats,
  isInitialLoading,
  onRefresh,
}: ProductionWorkspaceHeaderProps) => (
  <>
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="bg-gradient-to-br from-slate-900 to-slate-500 bg-clip-text text-3xl font-black tracking-tighter text-transparent dark:from-white dark:to-slate-400">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm font-bold text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2 rounded-[22px] border border-white/50 bg-white/60 p-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/60">
        <button className="flex items-center rounded-[17px] bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-2.5 text-xs font-black text-white shadow-lg shadow-blue-500/25">
          <Factory size={16} className="mr-2.5" />
          {title}
        </button>
        <button onClick={onRefresh} className="flex items-center rounded-[17px] px-4 py-2.5 text-xs font-black text-slate-500">
          <ScanBarcode size={16} className="mr-2.5" />
          批次追踪
        </button>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard title="BOM 数量" value={isInitialLoading ? '加载中...' : stats.totalBoms} color="bg-blue-600" icon={<PackageCheck size={24} />} />
      <StatCard title="工单数量" value={isInitialLoading ? '加载中...' : stats.totalWorkOrders} color="bg-emerald-500" icon={<Layers3 size={24} />} />
      <StatCard title="活跃工单" value={isInitialLoading ? '加载中...' : stats.activeWorkOrders} color="bg-cyan-500" icon={<Play size={24} />} />
      <StatCard title="待质检" value={isInitialLoading ? '加载中...' : stats.qcPendingCount} color="bg-amber-500" icon={<TriangleAlert size={24} />} />
      <StatCard title="批次数量" value={isInitialLoading ? '加载中...' : stats.batchCount} color="bg-violet-500" icon={<ScanBarcode size={24} />} />
      <StatCard title="库存总量" value={isInitialLoading ? '加载中...' : stats.totalStock} color="bg-slate-700" icon={<ArrowUpRight size={24} />} />
    </div>
  </>
);

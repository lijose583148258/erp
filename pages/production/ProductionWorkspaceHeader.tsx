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
    <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-4xl font-black tracking-tighter italic uppercase bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{title}</h1>
        <p className="text-blue-600 dark:text-blue-400 font-black text-[10px] uppercase tracking-[0.3em] mt-3 opacity-70 px-1">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-2 rounded-[28px] border border-white/50 dark:border-slate-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <button className="flex items-center px-6 py-3 rounded-[22px] text-[10px] font-black uppercase tracking-widest bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-500/30 active-shrink">
          <Factory size={16} className="mr-2.5" />
          {title}
        </button>
        <button onClick={onRefresh} className="flex items-center px-6 py-3 rounded-[22px] text-[10px] font-black uppercase tracking-widest text-slate-400">
          <ScanBarcode size={16} className="mr-2.5" />
          批次追踪
        </button>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-8">
      <StatCard title="BOM 数量" value={isInitialLoading ? '加载中...' : stats.totalBoms} color="bg-blue-600" icon={<PackageCheck size={24} />} />
      <StatCard title="工单数量" value={isInitialLoading ? '加载中...' : stats.totalWorkOrders} color="bg-emerald-500" icon={<Layers3 size={24} />} />
      <StatCard title="活跃工单" value={isInitialLoading ? '加载中...' : stats.activeWorkOrders} color="bg-cyan-500" icon={<Play size={24} />} />
      <StatCard title="待质检" value={isInitialLoading ? '加载中...' : stats.qcPendingCount} color="bg-amber-500" icon={<TriangleAlert size={24} />} />
      <StatCard title="批次数量" value={isInitialLoading ? '加载中...' : stats.batchCount} color="bg-violet-500" icon={<ScanBarcode size={24} />} />
      <StatCard title="库存总量" value={isInitialLoading ? '加载中...' : stats.totalStock} color="bg-slate-700" icon={<ArrowUpRight size={24} />} />
    </div>
  </>
);

import { Plus, RefreshCw, Warehouse } from 'lucide-react';

type WarehouseWorkspaceHeaderProps = {
  title: string;
  description: string;
  loading: boolean;
  showCreate: boolean;
  canWrite: boolean;
  onCreate: () => void;
  onRefresh: () => void;
};

export const WarehouseWorkspaceHeader = ({
  title,
  description,
  loading,
  showCreate,
  canWrite,
  onCreate,
  onRefresh,
}: WarehouseWorkspaceHeaderProps) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-4">
      <div className="w-14 h-14 bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 rounded-[22px] flex items-center justify-center shadow-xl shadow-orange-500/30">
        <Warehouse size={28} className="text-white" />
      </div>
      <div>
        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h1>
        <p className="text-sm text-slate-500 font-bold mt-0.5">{description}</p>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label="刷新仓储数据"
        onClick={onRefresh}
 className="p-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl text-slate-500 hover:text-blue-600 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none shadow-sm border border-white/40 dark:border-slate-700"
      >
        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
      </button>
      {showCreate ? (
        <button
          type="button"
          data-testid="warehouse-create-open"
          onClick={onCreate}
          disabled={!canWrite}
 className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-orange-500/30 hover:shadow-xl transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={16} /> 新建仓库
        </button>
      ) : null}
    </div>
  </div>
);

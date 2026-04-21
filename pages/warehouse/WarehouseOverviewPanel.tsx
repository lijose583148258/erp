import { Box, Building2, ChevronRight, MapPin, Package, Plus, TrendingUp, Warehouse as WarehouseIcon } from 'lucide-react';
import type { Warehouse } from '../../services/warehouse.service';

interface WarehouseOverviewPanelProps {
  warehouses: Warehouse[];
  loading: boolean;
  selectedWarehouse: Warehouse | null;
  setSelectedWarehouse: (warehouse: Warehouse) => void;
  openCreateLocation: () => void;
}

export function WarehouseOverviewPanel({
  warehouses,
  loading,
  selectedWarehouse,
  setSelectedWarehouse,
  openCreateLocation,
}: WarehouseOverviewPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        <h3 className="text-sm font-black text-slate-400 uppercase tracking-wider px-1">仓库列表</h3>
        {warehouses.length === 0 && !loading && (
          <div className="text-center py-12 text-slate-400">
            <WarehouseIcon size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-bold text-sm">暂无仓库</p>
            <p className="text-xs mt-1">点击"新建仓库"开始</p>
          </div>
        )}
        {warehouses.map(warehouse => (
          <button key={warehouse.id} onClick={() => setSelectedWarehouse(warehouse)}
            className={`w-full text-left p-5 rounded-[20px] transition-all border ${selectedWarehouse?.id === warehouse.id
              ? 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800 shadow-lg shadow-amber-500/10'
              : 'bg-white/70 dark:bg-slate-900/70 border-white/40 dark:border-slate-800 hover:shadow-md'}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-[14px] flex items-center justify-center ${warehouse.type === 'virtual' ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-600' : 'bg-amber-100 dark:bg-amber-900/50 text-amber-600'}`}>
                  <Building2 size={18} />
                </div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-white">{warehouse.name}</p>
                  <p className="text-xs text-slate-400 font-bold">{warehouse.code}</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-slate-300" />
            </div>
            <div className="flex gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><MapPin size={12} /> {warehouse.locations.length} 库位</span>
              <span className="flex items-center gap-1"><Package size={12} /> {warehouse._summary?.totalItems || 0} 品项</span>
              <span className="flex items-center gap-1"><TrendingUp size={12} /> {(warehouse._summary?.totalQuantity || 0).toFixed(1)}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="lg:col-span-2">
        {selectedWarehouse ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white">{selectedWarehouse.name}</h3>
                <p className="text-sm text-slate-400 font-bold">{selectedWarehouse.code} · {selectedWarehouse.type === 'virtual' ? '虚拟仓' : '实体仓'}</p>
              </div>
              <button onClick={openCreateLocation}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 rounded-xl font-black text-xs hover:bg-blue-100 dark:hover:bg-blue-900/50 active:scale-95 transition-all">
                <Plus size={14} /> 新增库位
              </button>
            </div>

            {selectedWarehouse.locations.length === 0 && (
              <div className="text-center py-12 bg-white/50 dark:bg-slate-900/50 rounded-[20px] border border-dashed border-slate-200 dark:border-slate-700">
                <MapPin size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-bold text-slate-400">该仓库暂无库位</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {selectedWarehouse.locations.map(location => (
                <div key={location.id} className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[20px] p-5 border border-white/40 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center text-sm font-black
                      ${location.type === 'production' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600' :
                        location.type === 'scrap' ? 'bg-red-100 dark:bg-red-900/50 text-red-600' :
                          'bg-blue-100 dark:bg-blue-900/50 text-blue-600'}`}>
                      <MapPin size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm text-slate-900 dark:text-white truncate">{location.name}</p>
                      <p className="text-xs text-slate-400">{location.code} · {location.type}</p>
                    </div>
                    <div className={`w-2.5 h-2.5 rounded-full ${location.status === 'active' ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                  </div>

                  {location.stockBalances.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">暂无库存</p>
                  ) : (
                    <div className="space-y-2">
                      {location.stockBalances.slice(0, 5).map((balance) => (
                        <div key={balance.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-50 dark:border-slate-800 last:border-0">
                          <div className="flex-1 min-w-0">
                            <span className="font-bold text-slate-700 dark:text-slate-200 truncate block">{balance.productName}</span>
                            <span className="text-slate-400">{balance.batchNo}</span>
                          </div>
                          <span className="font-black text-amber-600 dark:text-amber-400">{balance.quantity} {balance.unit}</span>
                        </div>
                      ))}
                      {location.stockBalances.length > 5 && (
                        <p className="text-xs text-slate-400 text-center">还有 {location.stockBalances.length - 5} 条...</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-20 text-slate-400">
            <Box size={48} className="mx-auto mb-4 opacity-30" />
            <p className="font-bold">选择左侧仓库查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

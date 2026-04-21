import type { Dispatch, SetStateAction } from 'react';
import type { Warehouse } from '../../services/warehouse.service';
import type { LocationDraft, WarehouseDraft } from './warehouseWorkspaceTypes';

interface WarehouseCreateDialogsProps {
  showCreateWarehouse: boolean;
  setShowCreateWarehouse: (value: boolean) => void;
  newWarehouse: WarehouseDraft;
  setNewWarehouse: Dispatch<SetStateAction<WarehouseDraft>>;
  handleCreateWarehouse: () => void;
  showCreateLocation: boolean;
  setShowCreateLocation: (value: boolean) => void;
  selectedWarehouse: Warehouse | null;
  newLocation: LocationDraft;
  setNewLocation: Dispatch<SetStateAction<LocationDraft>>;
  handleCreateLocation: () => void;
}

export function WarehouseCreateDialogs({
  showCreateWarehouse,
  setShowCreateWarehouse,
  newWarehouse,
  setNewWarehouse,
  handleCreateWarehouse,
  showCreateLocation,
  setShowCreateLocation,
  selectedWarehouse,
  newLocation,
  setNewLocation,
  handleCreateLocation,
}: WarehouseCreateDialogsProps) {
  return (
    <>
      {showCreateWarehouse && (
        <div className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-md flex items-center justify-center" onClick={() => setShowCreateWarehouse(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-[28px] p-8 w-full max-w-md shadow-2xl border border-white/40 dark:border-slate-800 animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 dark:text-white mb-6">新建仓库</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库编码 *</label>
                <input type="text" placeholder="如: WH-CHEM" value={newWarehouse.code}
                  onChange={e => setNewWarehouse(form => ({ ...form, code: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库名称 *</label>
                <input type="text" placeholder="如: 化工原料仓" value={newWarehouse.name}
                  onChange={e => setNewWarehouse(form => ({ ...form, name: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库类型</label>
                <select value={newWarehouse.type} onChange={e => setNewWarehouse(form => ({ ...form, type: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold">
                  <option value="physical">实体仓库</option>
                  <option value="virtual">虚拟仓库</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreateWarehouse(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200 active:scale-95 transition-all">取消</button>
              <button onClick={handleCreateWarehouse} className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-black text-sm shadow-lg active:scale-95 transition-all">创建</button>
            </div>
          </div>
        </div>
      )}

      {showCreateLocation && (
        <div className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-md flex items-center justify-center" onClick={() => setShowCreateLocation(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-[28px] p-8 w-full max-w-md shadow-2xl border border-white/40 dark:border-slate-800 animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">新建库位</h3>
            <p className="text-sm text-slate-400 font-bold mb-6">在「{selectedWarehouse?.name}」下创建</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位编码 *</label>
                <input type="text" placeholder="如: LOC-A01" value={newLocation.code}
                  onChange={e => setNewLocation(form => ({ ...form, code: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位名称 *</label>
                <input type="text" placeholder="如: A区1号架" value={newLocation.name}
                  onChange={e => setNewLocation(form => ({ ...form, name: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位类型</label>
                <select value={newLocation.type} onChange={e => setNewLocation(form => ({ ...form, type: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold">
                  <option value="internal">内部库位</option>
                  <option value="production">生产库位</option>
                  <option value="scrap">废料库位</option>
                  <option value="supplier">供应商库位</option>
                  <option value="customer">客户库位</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreateLocation(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200 active:scale-95 transition-all">取消</button>
              <button onClick={handleCreateLocation} className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-black text-sm shadow-lg active:scale-95 transition-all">创建</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

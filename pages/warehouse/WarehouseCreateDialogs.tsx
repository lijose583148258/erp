import type { Dispatch, SetStateAction } from 'react';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import type { Warehouse } from '../../services/warehouse.service';
import type { LocationCreateErrors, LocationDraft, WarehouseCreateErrors, WarehouseDraft } from './warehouseWorkspaceTypes';

interface WarehouseCreateDialogsProps {
  showCreateWarehouse: boolean;
  setShowCreateWarehouse: (value: boolean) => void;
  newWarehouse: WarehouseDraft;
  setNewWarehouse: Dispatch<SetStateAction<WarehouseDraft>>;
  warehouseErrors: WarehouseCreateErrors;
  clearWarehouseError: (field: keyof WarehouseCreateErrors) => void;
  warehouseCreating: boolean;
  handleCreateWarehouse: () => void;
  showCreateLocation: boolean;
  setShowCreateLocation: (value: boolean) => void;
  selectedWarehouse: Warehouse | null;
  newLocation: LocationDraft;
  setNewLocation: Dispatch<SetStateAction<LocationDraft>>;
  locationErrors: LocationCreateErrors;
  clearLocationError: (field: keyof LocationCreateErrors) => void;
  locationCreating: boolean;
  handleCreateLocation: () => void;
  canWrite: boolean;
}

export function WarehouseCreateDialogs({
  showCreateWarehouse,
  setShowCreateWarehouse,
  newWarehouse,
  setNewWarehouse,
  warehouseErrors,
  clearWarehouseError,
  warehouseCreating,
  handleCreateWarehouse,
  showCreateLocation,
  setShowCreateLocation,
  selectedWarehouse,
  newLocation,
  setNewLocation,
  locationErrors,
  clearLocationError,
  locationCreating,
  handleCreateLocation,
  canWrite,
}: WarehouseCreateDialogsProps) {
  const warehouseForm = useUnsavedForm({
    sourceId: 'warehouse-create-dialog',
    label: '新建仓库',
    open: showCreateWarehouse,
    value: newWarehouse,
  });
  const locationForm = useUnsavedForm({
    sourceId: 'warehouse-location-create-dialog',
    label: '新建库位',
    open: showCreateLocation,
    value: newLocation,
  });
  const closeWarehouse = () => warehouseForm.requestClose(() => setShowCreateWarehouse(false));
  const closeLocation = () => locationForm.requestClose(() => setShowCreateLocation(false));
  const controlClassName = (hasError = false) =>
    `w-full bg-slate-50 dark:bg-slate-800 border rounded-xl px-4 py-3 text-sm font-bold ${
      hasError ? 'border-rose-400 focus:ring-2 focus:ring-rose-100' : 'border-slate-200 dark:border-slate-700'
    }`;

  return (
    <>
      {showCreateWarehouse && (
        <div data-testid="warehouse-create-modal" className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-md flex items-center justify-center" onClick={closeWarehouse}>
 <div className="bg-white dark:bg-slate-900 rounded-[28px] p-8 w-full max-w-md shadow-2xl border border-white/40 dark:border-slate-800 motion-safe:animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 dark:text-white mb-6">新建仓库</h3>
            {!canWrite && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                当前角色只能查看仓储数据，不能新建仓库。
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库编码 *</label>
                <input data-testid="warehouse-create-code-input" type="text" placeholder="如: WH-CHEM" value={newWarehouse.code}
                  onChange={e => {
                    clearWarehouseError('code');
                    setNewWarehouse(form => ({ ...form, code: e.target.value }));
                  }}
                  aria-invalid={Boolean(warehouseErrors.code)}
                  aria-describedby={warehouseErrors.code ? 'warehouse-create-code-error' : undefined}
                  className={controlClassName(Boolean(warehouseErrors.code))} />
                {warehouseErrors.code ? <p id="warehouse-create-code-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{warehouseErrors.code}</p> : null}
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库名称 *</label>
                <input data-testid="warehouse-create-name-input" type="text" placeholder="如: 化工原料仓" value={newWarehouse.name}
                  onChange={e => {
                    clearWarehouseError('name');
                    setNewWarehouse(form => ({ ...form, name: e.target.value }));
                  }}
                  aria-invalid={Boolean(warehouseErrors.name)}
                  aria-describedby={warehouseErrors.name ? 'warehouse-create-name-error' : undefined}
                  className={controlClassName(Boolean(warehouseErrors.name))} />
                {warehouseErrors.name ? <p id="warehouse-create-name-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{warehouseErrors.name}</p> : null}
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库类型</label>
                <select value={newWarehouse.type} onChange={e => setNewWarehouse(form => ({ ...form, type: e.target.value }))}
                  className={controlClassName()}>
                  <option value="physical">实体仓库</option>
                  <option value="virtual">虚拟仓库</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
 <button data-testid="warehouse-create-cancel" onClick={closeWarehouse} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none">取消</button>
 <button data-testid="warehouse-create-confirm" onClick={handleCreateWarehouse} disabled={!canWrite || warehouseCreating} aria-busy={warehouseCreating} className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-black text-sm shadow-lg transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50">{warehouseCreating ? '创建中...' : '创建'}</button>
            </div>
          </div>
        </div>
      )}

      {showCreateLocation && (
        <div data-testid="warehouse-location-create-modal" className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-md flex items-center justify-center" onClick={closeLocation}>
 <div className="bg-white dark:bg-slate-900 rounded-[28px] p-8 w-full max-w-md shadow-2xl border border-white/40 dark:border-slate-800 motion-safe:animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">新建库位</h3>
            <p className="text-sm text-slate-400 font-bold mb-6">在「{selectedWarehouse?.name}」下创建</p>
            {locationErrors.warehouse ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{locationErrors.warehouse}</p> : null}
            {!canWrite && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                当前角色只能查看仓储数据，不能新建库位。
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位编码 *</label>
                <input data-testid="warehouse-location-create-code-input" type="text" placeholder="如: LOC-A01" value={newLocation.code}
                  onChange={e => {
                    clearLocationError('code');
                    setNewLocation(form => ({ ...form, code: e.target.value }));
                  }}
                  aria-invalid={Boolean(locationErrors.code)}
                  aria-describedby={locationErrors.code ? 'warehouse-location-create-code-error' : undefined}
                  className={controlClassName(Boolean(locationErrors.code))} />
                {locationErrors.code ? <p id="warehouse-location-create-code-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{locationErrors.code}</p> : null}
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位名称 *</label>
                <input data-testid="warehouse-location-create-name-input" type="text" placeholder="如: A区1号架" value={newLocation.name}
                  onChange={e => {
                    clearLocationError('name');
                    setNewLocation(form => ({ ...form, name: e.target.value }));
                  }}
                  aria-invalid={Boolean(locationErrors.name)}
                  aria-describedby={locationErrors.name ? 'warehouse-location-create-name-error' : undefined}
                  className={controlClassName(Boolean(locationErrors.name))} />
                {locationErrors.name ? <p id="warehouse-location-create-name-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{locationErrors.name}</p> : null}
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位类型</label>
                <select value={newLocation.type} onChange={e => setNewLocation(form => ({ ...form, type: e.target.value }))}
                  className={controlClassName()}>
                  <option value="internal">内部库位</option>
                  <option value="production">生产库位</option>
                  <option value="scrap">废料库位</option>
                  <option value="supplier">供应商库位</option>
                  <option value="customer">客户库位</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
 <button data-testid="warehouse-location-create-cancel" onClick={closeLocation} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none">取消</button>
 <button data-testid="warehouse-location-create-confirm" onClick={handleCreateLocation} disabled={!canWrite || locationCreating} aria-busy={locationCreating} className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-black text-sm shadow-lg transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50">{locationCreating ? '创建中...' : '创建'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

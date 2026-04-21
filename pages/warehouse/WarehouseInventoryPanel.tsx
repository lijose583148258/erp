import { Filter, Package, Search, X } from 'lucide-react';
import type { RefObject } from 'react';
import type { StockBalanceRecord, Warehouse } from '../../services/warehouse.service';
import type { InventoryFilterValues, StockMeta, WarehouseLocationOption } from './warehouseWorkspaceTypes';

interface WarehouseInventoryPanelProps {
  warehouses: Warehouse[];
  stockBalances: StockBalanceRecord[];
  stockMeta: StockMeta;
  searchKeyword: string;
  setSearchKeyword: (value: string) => void;
  inventoryWarehouseId: string;
  setInventoryWarehouseId: (value: string) => void;
  inventoryLocationId: string;
  setInventoryLocationId: (value: string) => void;
  inventoryLocations: WarehouseLocationOption[];
  inventoryFilterValuesRef: RefObject<InventoryFilterValues>;
  inventorySearchInputRef: RefObject<HTMLInputElement | null>;
  inventoryWarehouseSelectRef: RefObject<HTMLSelectElement | null>;
  inventoryLocationSelectRef: RefObject<HTMLSelectElement | null>;
  queryInventory: (page?: number) => void;
  loadStockBalances: (page?: number, overrides?: Partial<InventoryFilterValues>) => Promise<void>;
}

export function WarehouseInventoryPanel({
  warehouses,
  stockBalances,
  stockMeta,
  searchKeyword,
  setSearchKeyword,
  inventoryWarehouseId,
  setInventoryWarehouseId,
  inventoryLocationId,
  setInventoryLocationId,
  inventoryLocations,
  inventoryFilterValuesRef,
  inventorySearchInputRef,
  inventoryWarehouseSelectRef,
  inventoryLocationSelectRef,
  queryInventory,
  loadStockBalances,
}: WarehouseInventoryPanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
        <div className="flex-1 flex items-center gap-2 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl px-5 py-3 border border-white/40 dark:border-slate-800 shadow-sm">
          <Search size={18} className="text-slate-400" />
          <input ref={inventorySearchInputRef} data-testid="warehouse-inventory-search" type="text" placeholder="搜索产品名称..." value={searchKeyword}
            onChange={e => {
              const keyword = e.target.value;
              inventoryFilterValuesRef.current = { ...inventoryFilterValuesRef.current, keyword };
              setSearchKeyword(keyword);
            }}
            onKeyDown={e => e.key === 'Enter' && queryInventory()}
            className="bg-transparent border-none focus:ring-0 text-sm font-bold w-full text-slate-800 dark:text-white placeholder:text-slate-300" />
          {searchKeyword && (
            <button onClick={() => {
              const nextFilters = { ...inventoryFilterValuesRef.current, keyword: '' };
              inventoryFilterValuesRef.current = nextFilters;
              setSearchKeyword('');
              void loadStockBalances(1, nextFilters);
            }} className="text-slate-300 hover:text-slate-500">
              <X size={16} />
            </button>
          )}
        </div>
        <select
          ref={inventoryWarehouseSelectRef}
          data-testid="warehouse-inventory-warehouse-select"
          value={inventoryWarehouseId}
          onChange={(event) => {
            const warehouseId = event.target.value;
            inventoryFilterValuesRef.current = { ...inventoryFilterValuesRef.current, warehouseId, locationId: '' };
            setInventoryWarehouseId(warehouseId);
            setInventoryLocationId('');
          }}
          className="rounded-2xl border border-white/40 bg-white/70 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl focus:ring-2 focus:ring-amber-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white"
        >
          <option value="">全部仓库</option>
          {warehouses.map(warehouse => (
            <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
          ))}
        </select>
        <select
          ref={inventoryLocationSelectRef}
          data-testid="warehouse-inventory-location-select"
          value={inventoryLocationId}
          onChange={(event) => {
            const locationId = event.target.value;
            inventoryFilterValuesRef.current = { ...inventoryFilterValuesRef.current, locationId };
            setInventoryLocationId(locationId);
          }}
          className="rounded-2xl border border-white/40 bg-white/70 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl focus:ring-2 focus:ring-amber-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white"
        >
          <option value="">全部库位</option>
          {inventoryLocations.map(location => (
            <option key={location.id} value={location.id}>
              {location.warehouseName} / {location.name}
            </option>
          ))}
        </select>
        <button data-testid="warehouse-inventory-query-button" onClick={() => queryInventory()}
          className="flex items-center gap-2 px-5 py-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 rounded-2xl font-black text-sm hover:bg-blue-100 active:scale-95 transition-all">
          <Filter size={16} /> 查询
        </button>
      </div>

      <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[24px] border border-white/40 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                {['产品名称', '批次号', '数量', '单位', '仓库', '库位', '最后变动'].map(header => (
                  <th key={header} className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stockBalances.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400"><Package size={32} className="mx-auto mb-2 opacity-30" /><p className="font-bold text-sm">暂无库存数据</p></td></tr>
              ) : (
                stockBalances.map(balance => (
                  <tr key={balance.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-white">{balance.productName}</td>
                    <td className="px-5 py-3.5 text-slate-500 font-mono text-xs">{balance.batchNo}</td>
                    <td className="px-5 py-3.5 font-black text-amber-600 dark:text-amber-400">{balance.quantity}</td>
                    <td className="px-5 py-3.5 text-slate-400">{balance.unit}</td>
                    <td className="px-5 py-3.5 text-slate-500">{balance.warehouseName || '-'}</td>
                    <td className="px-5 py-3.5 text-slate-500">{balance.locationName || '-'}</td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs">{balance.lastMoveAt ? new Date(balance.lastMoveAt).toLocaleDateString('zh-CN') : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {stockMeta.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-400 font-bold">共 {stockMeta.total} 条</span>
            <div className="flex gap-2">
              <button disabled={stockMeta.page <= 1} onClick={() => queryInventory(stockMeta.page - 1)}
                className="px-4 py-2 text-xs font-black bg-slate-100 dark:bg-slate-800 rounded-xl disabled:opacity-30 hover:bg-slate-200 active:scale-95 transition-all">上一页</button>
              <span className="px-3 py-2 text-xs font-bold text-slate-500">{stockMeta.page} / {stockMeta.totalPages}</span>
              <button disabled={stockMeta.page >= stockMeta.totalPages} onClick={() => queryInventory(stockMeta.page + 1)}
                className="px-4 py-2 text-xs font-black bg-slate-100 dark:bg-slate-800 rounded-xl disabled:opacity-30 hover:bg-slate-200 active:scale-95 transition-all">下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

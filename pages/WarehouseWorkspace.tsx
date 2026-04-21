import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Warehouse, MapPin, Package, Plus, Search, RefreshCw,
  ChevronRight, Box, Layers, TrendingUp,
  Building2, BarChart3, Filter, X
} from 'lucide-react';
import { warehouseService, Warehouse as WarehouseType, StockBalanceRecord, normalizeWarehouseRecord } from '../services/warehouse.service';

/* ================================================================
   仓储管理工作台
   ================================================================ */

type TabKey = 'overview' | 'inventory' | 'inbound';

type StockBalanceQueryOverrides = {
  keyword?: string;
  warehouseId?: string;
  locationId?: string;
};

const WarehouseWorkspace: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalanceRecord[]>([]);
  const [stockMeta, setStockMeta] = useState<{ page: number; total: number; totalPages: number }>({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [inventoryWarehouseId, setInventoryWarehouseId] = useState('');
  const [inventoryLocationId, setInventoryLocationId] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseType | null>(null);
  const inventorySearchInputRef = useRef<HTMLInputElement | null>(null);
  const inventoryWarehouseSelectRef = useRef<HTMLSelectElement | null>(null);
  const inventoryLocationSelectRef = useRef<HTMLSelectElement | null>(null);
  const inventoryFilterValuesRef = useRef<Required<StockBalanceQueryOverrides>>({ keyword: '', warehouseId: '', locationId: '' });
  const stockRequestSeqRef = useRef(0);

  // ── 入库表单 ──
  const [inboundForm, setInboundForm] = useState({
    locationId: 0,
    productName: '',
    batchNo: '',
    quantity: 0,
    unit: 'kg',
  });
  const [inboundMsg, setInboundMsg] = useState('');
  const [inboundSaving, setInboundSaving] = useState(false);

  // ── 新建仓库/库位表单 ──
  const [showCreateWarehouse, setShowCreateWarehouse] = useState(false);
  const [newWarehouse, setNewWarehouse] = useState({ code: '', name: '', type: 'physical' });
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const [newLocation, setNewLocation] = useState({ code: '', name: '', type: 'internal' });

  // ── 数据加载 ──
  const loadWarehouses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await warehouseService.listWarehouses();
      const normalizedData = data.map(normalizeWarehouseRecord);
      setWarehouses(normalizedData);
      setSelectedWarehouse(prev => {
        if (normalizedData.length === 0) return null;
        if (!prev) return normalizedData[0];
        return normalizedData.find(item => item.id === prev.id) || normalizedData[0];
      });
    } catch (e) { console.error('加载仓库列表失败', e); }
    setLoading(false);
  }, []);

  const loadStockBalances = useCallback(async (page = 1, overrides: StockBalanceQueryOverrides = {}) => {
    const requestSeq = stockRequestSeqRef.current + 1;
    stockRequestSeqRef.current = requestSeq;
    try {
      const params: any = { page, pageSize: 50 };
      const currentFilters = inventoryFilterValuesRef.current;
      const keyword = overrides.keyword ?? currentFilters.keyword;
      const warehouseId = overrides.warehouseId ?? currentFilters.warehouseId;
      const locationId = overrides.locationId ?? currentFilters.locationId;
      if (keyword) params.productName = keyword;
      if (warehouseId) params.warehouseId = Number(warehouseId);
      if (locationId) params.locationId = Number(locationId);
      const result = await warehouseService.listStockBalances(params);
      if (requestSeq !== stockRequestSeqRef.current) return;
      setStockBalances(result.data);
      setStockMeta({ page: result.meta.page, total: result.meta.total, totalPages: result.meta.totalPages });
    } catch (e) { console.error('加载库存台账失败', e); }
  }, []);

  const queryInventory = useCallback((page = 1) => {
    const nextFilters = {
      keyword: inventorySearchInputRef.current?.value ?? searchKeyword,
      warehouseId: inventoryWarehouseSelectRef.current?.value ?? inventoryWarehouseId,
      locationId: inventoryLocationSelectRef.current?.value ?? inventoryLocationId,
    };
    inventoryFilterValuesRef.current = nextFilters;
    void loadStockBalances(page, nextFilters);
  }, [inventoryLocationId, inventoryWarehouseId, loadStockBalances, searchKeyword]);

  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);
  useEffect(() => { if (activeTab === 'inventory') loadStockBalances(); }, [activeTab, loadStockBalances]);

  // ── 操作 ──
  const handleCreateWarehouse = async () => {
    if (!newWarehouse.code || !newWarehouse.name) return;
    try {
      const createdWarehouse = normalizeWarehouseRecord(await warehouseService.createWarehouse(newWarehouse));
      setSelectedWarehouse(createdWarehouse);
      setNewWarehouse({ code: '', name: '', type: 'physical' });
      setShowCreateWarehouse(false);
      await loadWarehouses();
    } catch (e: any) {
      alert(e?.response?.data?.message || '创建仓库失败');
    }
  };

  const handleCreateLocation = async () => {
    if (!selectedWarehouse || !newLocation.code || !newLocation.name) return;
    try {
      await warehouseService.createLocation(selectedWarehouse.id, newLocation);
      setNewLocation({ code: '', name: '', type: 'internal' });
      setShowCreateLocation(false);
      loadWarehouses();
    } catch (e: any) {
      alert(e?.response?.data?.message || '创建库位失败');
    }
  };

  const handleInbound = async () => {
    if (inboundSaving) return;
    if (!inboundForm.locationId || !inboundForm.productName || !inboundForm.batchNo || inboundForm.quantity <= 0) {
      setInboundMsg('请填写完整的入库信息');
      return;
    }
    setInboundSaving(true);
    setInboundMsg('入库处理中...');
    try {
      await warehouseService.createStockBalance(inboundForm);
      setInboundMsg('✅ 入库成功');
      setInboundForm({ locationId: 0, productName: '', batchNo: '', quantity: 0, unit: 'kg' });
      loadWarehouses();
      if (activeTab === 'inventory') loadStockBalances();
    } catch (e: any) {
      setInboundMsg('❌ ' + (e?.response?.data?.message || '入库失败'));
    } finally {
      setInboundSaving(false);
    }
  };

  // ── 汇总统计 ──
  const totalItems = warehouses.reduce((sum, wh) => sum + (wh._summary?.totalItems || 0), 0);
  const totalQuantity = warehouses.reduce((sum, wh) => sum + (wh._summary?.totalQuantity || 0), 0);
  const totalLocations = warehouses.reduce((sum, wh) => sum + wh.locations.length, 0);

  // ── 所有库位（扁平化） ──
  const allLocations = warehouses.flatMap(wh =>
    wh.locations.map(loc => ({
      ...loc,
      warehouseName: wh.name,
      warehouseCode: wh.code,
    }))
  );
  const inventoryLocations = inventoryWarehouseId
    ? allLocations.filter(loc => String(loc.warehouseId) === inventoryWarehouseId)
    : allLocations;

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 rounded-[22px] flex items-center justify-center shadow-xl shadow-orange-500/30">
            <Warehouse size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">仓储管理</h1>
            <p className="text-sm text-slate-400 font-bold mt-0.5">Warehouse & Inventory Management</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { loadWarehouses(); if (activeTab === 'inventory') queryInventory(); }}
            className="p-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl text-slate-500 hover:text-blue-600 active:scale-95 transition-all shadow-sm border border-white/40 dark:border-slate-700">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowCreateWarehouse(true)}
            className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-orange-500/30 hover:shadow-xl active:scale-95 transition-all">
            <Plus size={16} /> 新建仓库
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '仓库数量', value: warehouses.length, icon: Building2, color: 'from-amber-500 to-orange-500', accent: 'text-amber-600' },
          { label: '库位总数', value: totalLocations, icon: MapPin, color: 'from-blue-500 to-indigo-500', accent: 'text-blue-600' },
          { label: '库存品项', value: totalItems, icon: Package, color: 'from-emerald-500 to-teal-500', accent: 'text-emerald-600' },
          { label: '库存总量', value: totalQuantity.toFixed(1) + ' kg', icon: BarChart3, color: 'from-violet-500 to-purple-500', accent: 'text-violet-600' },
        ].map((card, idx) => (
          <div key={idx} className="relative bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[24px] p-6 shadow-sm border border-white/40 dark:border-slate-800 overflow-hidden group hover:shadow-lg transition-all">
            <div className={`absolute -right-3 -top-3 w-16 h-16 bg-gradient-to-br ${card.color} rounded-[20px] opacity-10 group-hover:opacity-20 transition-opacity rotate-12`} />
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 bg-gradient-to-br ${card.color} rounded-[14px] flex items-center justify-center shadow-lg`}>
                <card.icon size={18} className="text-white" />
              </div>
              <span className="text-xs font-black text-slate-400 uppercase tracking-wider">{card.label}</span>
            </div>
            <p className={`text-2xl font-black ${card.accent} dark:text-white`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl p-1.5 border border-white/40 dark:border-slate-800 w-fit">
        {([
          { key: 'overview' as TabKey, label: '仓库概览', icon: Layers },
          { key: 'inventory' as TabKey, label: '库存台账', icon: Package },
          { key: 'inbound' as TabKey, label: '手动入库', icon: Plus },
        ]).map(tab => (
          <button key={tab.key} data-testid={`warehouse-tab-${tab.key}`} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-black transition-all ${activeTab === tab.key
              ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-500/30'
              : 'text-slate-500 hover:bg-white/60 dark:hover:bg-slate-800/60'}`}>
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════ 概览 ═══════════════ */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：仓库列表 */}
          <div className="lg:col-span-1 space-y-4">
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-wider px-1">仓库列表</h3>
            {warehouses.length === 0 && !loading && (
              <div className="text-center py-12 text-slate-400">
                <Warehouse size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-bold text-sm">暂无仓库</p>
                <p className="text-xs mt-1">点击"新建仓库"开始</p>
              </div>
            )}
            {warehouses.map(wh => (
              <button key={wh.id} onClick={() => setSelectedWarehouse(wh)}
                className={`w-full text-left p-5 rounded-[20px] transition-all border ${selectedWarehouse?.id === wh.id
                  ? 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800 shadow-lg shadow-amber-500/10'
                  : 'bg-white/70 dark:bg-slate-900/70 border-white/40 dark:border-slate-800 hover:shadow-md'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-[14px] flex items-center justify-center ${wh.type === 'virtual' ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-600' : 'bg-amber-100 dark:bg-amber-900/50 text-amber-600'}`}>
                      <Building2 size={18} />
                    </div>
                    <div>
                      <p className="font-black text-sm text-slate-900 dark:text-white">{wh.name}</p>
                      <p className="text-xs text-slate-400 font-bold">{wh.code}</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
                <div className="flex gap-4 mt-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><MapPin size={12} /> {wh.locations.length} 库位</span>
                  <span className="flex items-center gap-1"><Package size={12} /> {wh._summary?.totalItems || 0} 品项</span>
                  <span className="flex items-center gap-1"><TrendingUp size={12} /> {(wh._summary?.totalQuantity || 0).toFixed(1)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* 右侧：选中仓库详情 */}
          <div className="lg:col-span-2">
            {selectedWarehouse ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-black text-slate-900 dark:text-white">{selectedWarehouse.name}</h3>
                    <p className="text-sm text-slate-400 font-bold">{selectedWarehouse.code} · {selectedWarehouse.type === 'virtual' ? '虚拟仓' : '实体仓'}</p>
                  </div>
                  <button onClick={() => setShowCreateLocation(true)}
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
                  {selectedWarehouse.locations.map(loc => (
                    <div key={loc.id} className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[20px] p-5 border border-white/40 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center text-sm font-black
                          ${loc.type === 'production' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600' :
                            loc.type === 'scrap' ? 'bg-red-100 dark:bg-red-900/50 text-red-600' :
                              'bg-blue-100 dark:bg-blue-900/50 text-blue-600'}`}>
                          <MapPin size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm text-slate-900 dark:text-white truncate">{loc.name}</p>
                          <p className="text-xs text-slate-400">{loc.code} · {loc.type}</p>
                        </div>
                        <div className={`w-2.5 h-2.5 rounded-full ${loc.status === 'active' ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                      </div>

                      {loc.stockBalances.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">暂无库存</p>
                      ) : (
                        <div className="space-y-2">
                          {loc.stockBalances.slice(0, 5).map((sb) => (
                            <div key={sb.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-50 dark:border-slate-800 last:border-0">
                              <div className="flex-1 min-w-0">
                                <span className="font-bold text-slate-700 dark:text-slate-200 truncate block">{sb.productName}</span>
                                <span className="text-slate-400">{sb.batchNo}</span>
                              </div>
                              <span className="font-black text-amber-600 dark:text-amber-400">{sb.quantity} {sb.unit}</span>
                            </div>
                          ))}
                          {loc.stockBalances.length > 5 && (
                            <p className="text-xs text-slate-400 text-center">还有 {loc.stockBalances.length - 5} 条...</p>
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
      )}

      {/* ═══════════════ 库存台账 ═══════════════ */}
      {activeTab === 'inventory' && (
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
                    {['产品名称', '批次号', '数量', '单位', '仓库', '库位', '最后变动'].map(h => (
                      <th key={h} className="text-left px-5 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stockBalances.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-slate-400"><Package size={32} className="mx-auto mb-2 opacity-30" /><p className="font-bold text-sm">暂无库存数据</p></td></tr>
                  ) : (
                    stockBalances.map(sb => (
                      <tr key={sb.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-white">{sb.productName}</td>
                        <td className="px-5 py-3.5 text-slate-500 font-mono text-xs">{sb.batchNo}</td>
                        <td className="px-5 py-3.5 font-black text-amber-600 dark:text-amber-400">{sb.quantity}</td>
                        <td className="px-5 py-3.5 text-slate-400">{sb.unit}</td>
                        <td className="px-5 py-3.5 text-slate-500">{sb.warehouseName || '-'}</td>
                        <td className="px-5 py-3.5 text-slate-500">{sb.locationName || '-'}</td>
                        <td className="px-5 py-3.5 text-slate-400 text-xs">{sb.lastMoveAt ? new Date(sb.lastMoveAt).toLocaleDateString('zh-CN') : '-'}</td>
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
      )}

      {/* ═══════════════ 手动入库 ═══════════════ */}
      {activeTab === 'inbound' && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[24px] p-8 border border-white/40 dark:border-slate-800 shadow-sm space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-[14px] flex items-center justify-center shadow-lg">
                <Plus size={18} className="text-white" />
              </div>
              <div>
                <h3 className="font-black text-lg text-slate-900 dark:text-white">手动入库</h3>
                <p className="text-xs text-slate-400">将原料或成品录入指定库位</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">入库库位 *</label>
                <select data-testid="warehouse-inbound-location-select" value={inboundForm.locationId} onChange={e => setInboundForm(f => ({ ...f, locationId: Number(e.target.value) }))}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all">
                  <option value={0}>-- 选择库位 --</option>
                  {allLocations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.warehouseName} / {loc.name} ({loc.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">产品名称 *</label>
                <input data-testid="warehouse-inbound-product-input" type="text" placeholder="如: 丁酮 (MEK)" value={inboundForm.productName}
                  onChange={e => setInboundForm(f => ({ ...f, productName: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all" />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">批次号 *</label>
                <input data-testid="warehouse-inbound-batch-input" type="text" placeholder="如: BATCH-2026-001" value={inboundForm.batchNo}
                  onChange={e => setInboundForm(f => ({ ...f, batchNo: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all" />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">数量 *</label>
                  <input data-testid="warehouse-inbound-quantity-input" type="number" min={0} step={0.01} value={inboundForm.quantity || ''}
                    onChange={e => setInboundForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all" />
                </div>
                <div className="w-24">
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">单位</label>
                  <select data-testid="warehouse-inbound-unit-select" value={inboundForm.unit} onChange={e => setInboundForm(f => ({ ...f, unit: e.target.value }))}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all">
                    {['kg', 'L', '桶', '瓶', '个', '吨'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {inboundMsg && (
              <div data-testid="warehouse-inbound-message" className={`text-sm font-bold px-4 py-3 rounded-xl border ${inboundMsg.startsWith('✅') ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 border-emerald-200 dark:border-emerald-800' : inboundMsg.includes('处理中') ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 border-blue-200 dark:border-blue-800' : 'bg-red-50 dark:bg-red-900/30 text-red-600 border-red-200 dark:border-red-800'}`}>
                {inboundMsg}
              </div>
            )}

            <button data-testid="warehouse-inbound-confirm-button" onClick={handleInbound} disabled={inboundSaving}
              className={`w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-emerald-500/30 hover:shadow-xl active:scale-[0.98] transition-all ${inboundSaving ? 'opacity-70 cursor-not-allowed' : ''}`}>
              {inboundSaving ? '入库处理中...' : '确认入库'}
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ 新建仓库对话框 ═══════════════ */}
      {showCreateWarehouse && (
        <div className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-md flex items-center justify-center" onClick={() => setShowCreateWarehouse(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-[28px] p-8 w-full max-w-md shadow-2xl border border-white/40 dark:border-slate-800 animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 dark:text-white mb-6">新建仓库</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库编码 *</label>
                <input type="text" placeholder="如: WH-CHEM" value={newWarehouse.code}
                  onChange={e => setNewWarehouse(f => ({ ...f, code: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库名称 *</label>
                <input type="text" placeholder="如: 化工原料仓" value={newWarehouse.name}
                  onChange={e => setNewWarehouse(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">仓库类型</label>
                <select value={newWarehouse.type} onChange={e => setNewWarehouse(f => ({ ...f, type: e.target.value }))}
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

      {/* ═══════════════ 新建库位对话框 ═══════════════ */}
      {showCreateLocation && (
        <div className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-md flex items-center justify-center" onClick={() => setShowCreateLocation(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-[28px] p-8 w-full max-w-md shadow-2xl border border-white/40 dark:border-slate-800 animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">新建库位</h3>
            <p className="text-sm text-slate-400 font-bold mb-6">在「{selectedWarehouse?.name}」下创建</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位编码 *</label>
                <input type="text" placeholder="如: LOC-A01" value={newLocation.code}
                  onChange={e => setNewLocation(f => ({ ...f, code: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位名称 *</label>
                <input type="text" placeholder="如: A区1号架" value={newLocation.name}
                  onChange={e => setNewLocation(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">库位类型</label>
                <select value={newLocation.type} onChange={e => setNewLocation(f => ({ ...f, type: e.target.value }))}
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
    </div>
  );
};

export default WarehouseWorkspace;

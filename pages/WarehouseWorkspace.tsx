import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Warehouse, MapPin, Package, Plus, RefreshCw,
  Layers, Building2, BarChart3
} from 'lucide-react';
import { warehouseService, Warehouse as WarehouseType, StockBalanceRecord, normalizeWarehouseRecord } from '../services/warehouse.service';
import { WarehouseCreateDialogs } from './warehouse/WarehouseCreateDialogs';
import { WarehouseInboundPanel } from './warehouse/WarehouseInboundPanel';
import { WarehouseInventoryPanel } from './warehouse/WarehouseInventoryPanel';
import { WarehouseOverviewPanel } from './warehouse/WarehouseOverviewPanel';
import {
  type InboundFormState,
  type InventoryFilterValues,
  type LocationDraft,
  type StockBalanceQueryOverrides,
  type StockMeta,
  type TabKey,
  type WarehouseDraft,
  type WarehouseLocationOption,
} from './warehouse/warehouseWorkspaceTypes';

/* ================================================================
   仓储管理工作台
   ================================================================ */

const WarehouseWorkspace = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalanceRecord[]>([]);
  const [stockMeta, setStockMeta] = useState<StockMeta>({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [inventoryWarehouseId, setInventoryWarehouseId] = useState('');
  const [inventoryLocationId, setInventoryLocationId] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseType | null>(null);
  const inventorySearchInputRef = useRef<HTMLInputElement | null>(null);
  const inventoryWarehouseSelectRef = useRef<HTMLSelectElement | null>(null);
  const inventoryLocationSelectRef = useRef<HTMLSelectElement | null>(null);
  const inventoryFilterValuesRef = useRef<InventoryFilterValues>({ keyword: '', warehouseId: '', locationId: '' });
  const stockRequestSeqRef = useRef(0);

  // ── 入库表单 ──
  const [inboundForm, setInboundForm] = useState<InboundFormState>({
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
  const [newWarehouse, setNewWarehouse] = useState<WarehouseDraft>({ code: '', name: '', type: 'physical' });
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const [newLocation, setNewLocation] = useState<LocationDraft>({ code: '', name: '', type: 'internal' });

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
  const allLocations: WarehouseLocationOption[] = warehouses.flatMap(wh =>
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
        <WarehouseOverviewPanel
          warehouses={warehouses}
          loading={loading}
          selectedWarehouse={selectedWarehouse}
          setSelectedWarehouse={setSelectedWarehouse}
          openCreateLocation={() => setShowCreateLocation(true)}
        />
      )}

      {/* ═══════════════ 库存台账 ═══════════════ */}
      {activeTab === 'inventory' && (
        <WarehouseInventoryPanel
          warehouses={warehouses}
          stockBalances={stockBalances}
          stockMeta={stockMeta}
          searchKeyword={searchKeyword}
          setSearchKeyword={setSearchKeyword}
          inventoryWarehouseId={inventoryWarehouseId}
          setInventoryWarehouseId={setInventoryWarehouseId}
          inventoryLocationId={inventoryLocationId}
          setInventoryLocationId={setInventoryLocationId}
          inventoryLocations={inventoryLocations}
          inventoryFilterValuesRef={inventoryFilterValuesRef}
          inventorySearchInputRef={inventorySearchInputRef}
          inventoryWarehouseSelectRef={inventoryWarehouseSelectRef}
          inventoryLocationSelectRef={inventoryLocationSelectRef}
          queryInventory={queryInventory}
          loadStockBalances={loadStockBalances}
        />
      )}

      {/* ═══════════════ 手动入库 ═══════════════ */}
      {activeTab === 'inbound' && (
        <WarehouseInboundPanel
          allLocations={allLocations}
          inboundForm={inboundForm}
          setInboundForm={setInboundForm}
          inboundMsg={inboundMsg}
          inboundSaving={inboundSaving}
          handleInbound={handleInbound}
        />
      )}

      <WarehouseCreateDialogs
        showCreateWarehouse={showCreateWarehouse}
        setShowCreateWarehouse={setShowCreateWarehouse}
        newWarehouse={newWarehouse}
        setNewWarehouse={setNewWarehouse}
        handleCreateWarehouse={handleCreateWarehouse}
        showCreateLocation={showCreateLocation}
        setShowCreateLocation={setShowCreateLocation}
        selectedWarehouse={selectedWarehouse}
        newLocation={newLocation}
        setNewLocation={setNewLocation}
        handleCreateLocation={handleCreateLocation}
      />
    </div>
  );
};

export default WarehouseWorkspace;

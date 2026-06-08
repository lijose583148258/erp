import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Warehouse, MapPin, Package, Plus, RefreshCw,
  Building2, BarChart3
} from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { can } from '../app/permissions';
import { getModuleDescription, getModuleTitle } from '../components/navigation/moduleRegistry';
import { DocumentInputGuide } from '../components/ui/DocumentInputGuide';
import { WorkspaceTaskNavigator } from '../components/ui/WorkspaceTaskNavigator';
import { warehouseService, Warehouse as WarehouseType, StockBalanceRecord, StockEntryRecord, normalizeWarehouseRecord } from '../services/warehouse.service';
import { WarehouseCreateDialogs } from './warehouse/WarehouseCreateDialogs';
import { WarehouseInboundPanel } from './warehouse/WarehouseInboundPanel';
import { WarehouseInventoryPanel } from './warehouse/WarehouseInventoryPanel';
import { WarehouseLedgerPanel } from './warehouse/WarehouseLedgerPanel';
import { WarehouseOverviewPanel } from './warehouse/WarehouseOverviewPanel';
import { WarehouseTransferDialog } from './warehouse/WarehouseTransferDialog';
import {
  resolveWarehouseErrorMessage,
  warehouseInputGuideBoundaries,
  warehouseInputGuideSteps,
} from './warehouse/warehouseWorkspaceContent';
import { buildWarehouseTabs } from './warehouse/warehouseWorkspaceNavigation';
import {
  type InboundFormState,
  type InventoryFilterValues,
  type LocationDraft,
  type StockBalanceQueryOverrides,
  type StockMeta,
  type TabKey,
  type TransferFormState,
  type WarehouseDraft,
  type WarehouseLocationOption,
} from './warehouse/warehouseWorkspaceTypes';

/* ================================================================
   仓储管理工作台
   ================================================================ */

const WarehouseWorkspace = () => {
  const { language, currentUser, notify } = useAppContext();
  const canViewLedger = can(currentUser, 'warehouse.ledger.read');
  const canWriteWarehouse = can(currentUser, 'warehouse.write');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalanceRecord[]>([]);
  const [stockEntries, setStockEntries] = useState<StockEntryRecord[]>([]);
  const [stockMeta, setStockMeta] = useState<StockMeta>({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [stockEntryLoading, setStockEntryLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [inventoryWarehouseId, setInventoryWarehouseId] = useState('');
  const [inventoryLocationId, setInventoryLocationId] = useState('');
  const [ledgerSourceType, setLedgerSourceType] = useState('warehouse_transfer');
  const [ledgerProductName, setLedgerProductName] = useState('');
  const [ledgerBatchNo, setLedgerBatchNo] = useState('');
  const [ledgerSourceRef, setLedgerSourceRef] = useState('');
  const [ledgerWarehouseId, setLedgerWarehouseId] = useState('');
  const [ledgerLocationId, setLedgerLocationId] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseType | null>(null);
  const inventorySearchInputRef = useRef<HTMLInputElement | null>(null);
  const inventoryWarehouseSelectRef = useRef<HTMLSelectElement | null>(null);
  const inventoryLocationSelectRef = useRef<HTMLSelectElement | null>(null);
  const inventoryFilterValuesRef = useRef<InventoryFilterValues>({ keyword: '', warehouseId: '', locationId: '' });
  const stockRequestSeqRef = useRef(0);
  const stockEntryRequestSeqRef = useRef(0);
  const hasLoadedLedgerRef = useRef(false);

  // ── 入库表单 ──
  const [inboundForm, setInboundForm] = useState<InboundFormState>({
    locationId: 0,
    productName: '',
    batchNo: '',
    quantity: 0,
    unit: 'kg',
    sourceRef: '',
    reason: '',
    note: '',
  });
  const [inboundMsg, setInboundMsg] = useState('');
  const [inboundSaving, setInboundSaving] = useState(false);

  // ── 库存调拨表单 ──
  const [transferBalance, setTransferBalance] = useState<StockBalanceRecord | null>(null);
  const [transferForm, setTransferForm] = useState<TransferFormState>({ toLocationId: 0, quantity: 0, note: '' });
  const [transferMsg, setTransferMsg] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);

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
    } catch (e: unknown) {
      notify('error', resolveWarehouseErrorMessage(e, '仓库列表加载失败，当前页面可能不是最新数据'));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadStockBalances = useCallback(async (page = 1, overrides: StockBalanceQueryOverrides = {}) => {
    const requestSeq = stockRequestSeqRef.current + 1;
    stockRequestSeqRef.current = requestSeq;
    try {
      const params: Parameters<typeof warehouseService.listStockBalances>[0] = { page, pageSize: 50 };
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
    } catch (e: unknown) {
      notify('error', resolveWarehouseErrorMessage(e, '库存台账加载失败，请刷新后再核对库存余额'));
    }
  }, [notify]);

  const queryInventory = useCallback((page = 1) => {
    const nextFilters = {
      keyword: inventorySearchInputRef.current?.value ?? searchKeyword,
      warehouseId: inventoryWarehouseSelectRef.current?.value ?? inventoryWarehouseId,
      locationId: inventoryLocationSelectRef.current?.value ?? inventoryLocationId,
    };
    inventoryFilterValuesRef.current = nextFilters;
    void loadStockBalances(page, nextFilters);
  }, [inventoryLocationId, inventoryWarehouseId, loadStockBalances, searchKeyword]);

  const loadStockEntries = useCallback(async (overrides: {
    sourceType?: string;
    productName?: string;
    batchNo?: string;
    sourceRef?: string;
    warehouseId?: string;
    locationId?: string;
  } = {}) => {
    if (!canViewLedger) return;
    const requestSeq = stockEntryRequestSeqRef.current + 1;
    stockEntryRequestSeqRef.current = requestSeq;
    setStockEntryLoading(true);
    try {
      const sourceType = overrides.sourceType ?? ledgerSourceType;
      const productName = overrides.productName ?? ledgerProductName;
      const batchNo = overrides.batchNo ?? ledgerBatchNo;
      const sourceRef = overrides.sourceRef ?? ledgerSourceRef;
      const warehouseId = overrides.warehouseId ?? ledgerWarehouseId;
      const locationId = overrides.locationId ?? ledgerLocationId;
      const data = await warehouseService.listStockEntries({
        limit: 100,
        sourceType: sourceType || undefined,
        sourceRef: sourceRef || undefined,
        productName: productName || undefined,
        batchNo: batchNo || undefined,
        warehouseId: warehouseId ? Number(warehouseId) : undefined,
        locationId: locationId ? Number(locationId) : undefined,
      });
      if (requestSeq !== stockEntryRequestSeqRef.current) return;
      setStockEntries(data);
      hasLoadedLedgerRef.current = true;
    } catch (e: unknown) {
      notify('error', resolveWarehouseErrorMessage(e, '库存流水加载失败，请不要把空表当作无流水'));
    } finally {
      if (requestSeq === stockEntryRequestSeqRef.current) {
        setStockEntryLoading(false);
      }
    }
  }, [canViewLedger, ledgerBatchNo, ledgerLocationId, ledgerProductName, ledgerSourceRef, ledgerSourceType, ledgerWarehouseId, notify]);

  const queryLedger = useCallback(() => {
    void loadStockEntries();
  }, [loadStockEntries]);

  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);
  useEffect(() => { if (activeTab === 'inventory') loadStockBalances(); }, [activeTab, loadStockBalances]);
  useEffect(() => {
    if (activeTab === 'ledger' && !canViewLedger) {
      setActiveTab('overview');
    }
  }, [activeTab, canViewLedger]);
  useEffect(() => {
    if (activeTab === 'ledger' && canViewLedger && !hasLoadedLedgerRef.current) {
      void loadStockEntries();
    }
  }, [activeTab, canViewLedger, loadStockEntries]);

  // ── 操作 ──
  const handleCreateWarehouse = async () => {
    if (!canWriteWarehouse) {
      notify('warning', '当前角色只能查看仓储数据，不能新建仓库');
      return;
    }
    if (!newWarehouse.code || !newWarehouse.name) return;
    try {
      const createdWarehouse = normalizeWarehouseRecord(await warehouseService.createWarehouse(newWarehouse));
      setSelectedWarehouse(createdWarehouse);
      setNewWarehouse({ code: '', name: '', type: 'physical' });
      setShowCreateWarehouse(false);
      await loadWarehouses();
    } catch (e: unknown) {
      notify('error', resolveWarehouseErrorMessage(e, '创建仓库失败'));
    }
  };

  const handleCreateLocation = async () => {
    if (!canWriteWarehouse) {
      notify('warning', '当前角色只能查看仓储数据，不能新建库位');
      return;
    }
    if (!selectedWarehouse || !newLocation.code || !newLocation.name) return;
    try {
      await warehouseService.createLocation(selectedWarehouse.id, newLocation);
      setNewLocation({ code: '', name: '', type: 'internal' });
      setShowCreateLocation(false);
      loadWarehouses();
    } catch (e: unknown) {
      notify('error', resolveWarehouseErrorMessage(e, '创建库位失败'));
    }
  };

  const handleInbound = async () => {
    if (inboundSaving) return;
    if (!canWriteWarehouse) {
      setInboundMsg('当前角色只能查看仓储数据，不能执行应急补录 / 盘盈入库。');
      return;
    }
    if (!inboundForm.locationId || !inboundForm.productName || !inboundForm.batchNo || inboundForm.quantity <= 0) {
      setInboundMsg('请填写完整的应急补录 / 盘盈入库信息。本入口不能代替采购收货、生产入库或货抵入库。');
      return;
    }
    if (!inboundForm.sourceRef.trim() || !inboundForm.reason.trim()) {
      setInboundMsg('请填写补录来源单号和明确原因，便于库存流水回读。');
      return;
    }
    setInboundSaving(true);
    try {
      const readbackFilters = {
        sourceType: 'warehouse_manual_inbound',
        productName: inboundForm.productName,
        batchNo: inboundForm.batchNo,
        sourceRef: inboundForm.sourceRef.trim(),
        warehouseId: '',
        locationId: String(inboundForm.locationId),
      };
      setInboundMsg('应急补录 / 盘盈入库处理中...');
      await warehouseService.createStockBalance(inboundForm);
      setInboundForm({ locationId: 0, productName: '', batchNo: '', quantity: 0, unit: 'kg', sourceRef: '', reason: '', note: '' });
      setLedgerSourceType(readbackFilters.sourceType);
      setLedgerProductName(readbackFilters.productName);
      setLedgerBatchNo(readbackFilters.batchNo);
      setLedgerSourceRef(readbackFilters.sourceRef);
      setLedgerWarehouseId(readbackFilters.warehouseId);
      setLedgerLocationId(readbackFilters.locationId);
      setInboundMsg(`✓ 应急补录 / 盘盈入库成功，可在库存流水用来源单号 ${readbackFilters.sourceRef} 回读凭证。`);
      await Promise.all([
        loadWarehouses(),
        loadStockBalances(stockMeta.page),
        canViewLedger ? loadStockEntries(readbackFilters) : Promise.resolve(),
      ]);
    } catch (e: unknown) {
      setInboundMsg('✗ ' + resolveWarehouseErrorMessage(e, '应急补录 / 盘盈入库失败'));
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

  const handleOpenTransfer = (balance: StockBalanceRecord) => {
    if (!canWriteWarehouse) {
      setTransferMsg('当前角色只能查看仓储数据，不能库存调拨');
      return;
    }
    const availableQuantity = Number(balance.quantity || 0);
    const defaultTarget = allLocations.find(location => Number(location.id) !== Number(balance.locationId));
    setTransferBalance(balance);
    setTransferForm({
      toLocationId: defaultTarget?.id || 0,
      quantity: availableQuantity > 0 ? Math.min(availableQuantity, 1) : 0,
      note: '',
    });
    setTransferMsg('');
  };

  const handleCloseTransfer = () => {
    if (transferSaving) return;
    setTransferBalance(null);
    setTransferForm({ toLocationId: 0, quantity: 0, note: '' });
    setTransferMsg('');
  };

  const handleTransfer = async () => {
    if (!transferBalance || transferSaving) return;
    if (!canWriteWarehouse) {
      setTransferMsg('当前角色只能查看仓储数据，不能库存调拨');
      return;
    }
    const quantity = Number(transferForm.quantity || 0);
    const toLocationId = Number(transferForm.toLocationId || 0);
    if (!toLocationId) {
      setTransferMsg('请选择目标库位');
      return;
    }
    if (toLocationId === Number(transferBalance.locationId)) {
      setTransferMsg('目标库位不能和当前库位相同');
      return;
    }
    if (quantity <= 0) {
      setTransferMsg('调拨数量必须大于 0');
      return;
    }
    if (quantity > Number(transferBalance.quantity || 0)) {
      setTransferMsg('调拨数量不能超过当前库存');
      return;
    }

    setTransferSaving(true);
    setTransferMsg('调拨处理中...');
    try {
      const requestId = `UI-WH-XFER-${transferBalance.id}-${Date.now()}`;
      const transferResult = await warehouseService.transferStockBalance(transferBalance.id, {
        toLocationId,
        quantity,
        note: transferForm.note,
        requestId,
      });
      const readbackFilters = {
        sourceType: 'warehouse_transfer',
        productName: transferBalance.productName,
        batchNo: transferBalance.batchNo,
        sourceRef: transferResult.sourceRef,
        warehouseId: '',
        locationId: '',
      };
      setLedgerSourceType(readbackFilters.sourceType);
      setLedgerProductName(readbackFilters.productName);
      setLedgerBatchNo(readbackFilters.batchNo);
      setLedgerSourceRef(readbackFilters.sourceRef);
      setLedgerWarehouseId(readbackFilters.warehouseId);
      setLedgerLocationId(readbackFilters.locationId);
      setTransferMsg(`✓ 调拨成功，正在刷新库存台账；库存流水可用 ${transferResult.sourceRef} 回读。`);
      await Promise.all([
        loadWarehouses(),
        loadStockBalances(stockMeta.page),
        canViewLedger ? loadStockEntries(readbackFilters) : Promise.resolve(),
      ]);
      setTransferBalance(null);
      setTransferForm({ toLocationId: 0, quantity: 0, note: '' });
    } catch (e: unknown) {
      setTransferMsg(resolveWarehouseErrorMessage(e, '调拨失败'));
    } finally {
      setTransferSaving(false);
    }
  };

  const warehouseTabs = buildWarehouseTabs({
    warehouses: warehouses.length,
    stockBalances: stockBalances.length,
    stockTotal: stockMeta.total,
    stockEntries: stockEntries.length,
    locations: allLocations.length,
  }, canViewLedger);

  return (
    <div
      className="space-y-6"
      data-complex-input-module="warehouse"
      data-complex-input-grid="<table inventory balances; ledger rows"
      data-complex-input-action="warehouse transfer; manual inbound; audit sourceRef; negative-stock guard"
      data-complex-input-readback="刷新库存台账; 回读库存流水; sourceRef evidence"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 rounded-[22px] flex items-center justify-center shadow-xl shadow-orange-500/30">
            <Warehouse size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">{getModuleTitle('warehouse', language)}</h1>
            <p className="text-sm text-slate-400 font-bold mt-0.5">{getModuleDescription('warehouse', language)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { loadWarehouses(); if (activeTab === 'inventory') queryInventory(); }}
            className="p-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl text-slate-500 hover:text-blue-600 active:scale-95 transition-all shadow-sm border border-white/40 dark:border-slate-700">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          {activeTab === 'overview' ? (
            <button data-testid="warehouse-create-open" onClick={() => canWriteWarehouse ? setShowCreateWarehouse(true) : notify('warning', '当前角色只能查看仓储数据，不能新建仓库')}
              disabled={!canWriteWarehouse}
              className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-orange-500/30 hover:shadow-xl active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-50">
              <Plus size={16} /> 新建仓库
            </button>
          ) : null}
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

      <DocumentInputGuide
        testId="warehouse-complex-input-guide"
        tone="amber"
        eyebrow="仓储复杂输入路径"
        title="仓库 / 库位主档 + 库存台账 + 入库 / 调拨动作 + 回读证据"
        description="先把仓库和库位主档维护清楚，再在库存台账确认余额；所有写库存的动作必须通过受控入口发起，保存后回到库存流水按来源单号、产品、批次、库位核对。"
        steps={warehouseInputGuideSteps}
        boundaries={warehouseInputGuideBoundaries}
        evidence={['库存余额刷新', '库存流水 sourceRef', '调拨双边记录', '负库存拦截']}
      />

      {/* 职责导航 */}
      <WorkspaceTaskNavigator
        eyebrow="仓储职责导航"
        title="先确定位置，再看余额，再追流水"
        description="仓储页按成熟库存系统拆成“库位主数据 / 库存余额 / 库存流水 / 应急补录”。同一块区域不再同时承担建仓、查库存、调拨和补录。"
        items={warehouseTabs}
        activeId={activeTab}
        onChange={(id) => {
          if (id === 'overview' || id === 'inventory' || id === 'ledger' || id === 'inbound') {
            setActiveTab(id);
          }
        }}
        variant="amber"
        columns="four"
      />

      {/* ═══════════════ 概览 ═══════════════ */}
      {activeTab === 'overview' && (
        <WarehouseOverviewPanel
          warehouses={warehouses}
          loading={loading}
          selectedWarehouse={selectedWarehouse}
          setSelectedWarehouse={setSelectedWarehouse}
          openCreateLocation={() => canWriteWarehouse ? setShowCreateLocation(true) : notify('warning', '当前角色只能查看仓储数据，不能新建库位')}
          canWrite={canWriteWarehouse}
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
          onOpenTransfer={handleOpenTransfer}
          canWrite={canWriteWarehouse}
        />
      )}

      {/* ═══════════════ 库存流水 ═══════════════ */}
      {activeTab === 'ledger' && (
        <WarehouseLedgerPanel
          warehouses={warehouses}
          allLocations={allLocations}
          entries={stockEntries}
          loading={stockEntryLoading}
          sourceType={ledgerSourceType}
          setSourceType={setLedgerSourceType}
          productName={ledgerProductName}
          setProductName={setLedgerProductName}
          batchNo={ledgerBatchNo}
          setBatchNo={setLedgerBatchNo}
          sourceRef={ledgerSourceRef}
          setSourceRef={setLedgerSourceRef}
          warehouseId={ledgerWarehouseId}
          setWarehouseId={setLedgerWarehouseId}
          locationId={ledgerLocationId}
          setLocationId={setLedgerLocationId}
          queryLedger={queryLedger}
        />
      )}

      {/* ═══════════════ 应急补录 / 盘盈入库 ═══════════════ */}
      {activeTab === 'inbound' && (
        <WarehouseInboundPanel
          allLocations={allLocations}
          inboundForm={inboundForm}
          setInboundForm={setInboundForm}
          inboundMsg={inboundMsg}
          inboundSaving={inboundSaving}
          handleInbound={handleInbound}
          canWrite={canWriteWarehouse}
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
        canWrite={canWriteWarehouse}
      />
      <WarehouseTransferDialog
        balance={transferBalance}
        allLocations={allLocations}
        transferForm={transferForm}
        setTransferForm={setTransferForm}
        transferMsg={transferMsg}
        transferSaving={transferSaving}
        onClose={handleCloseTransfer}
        onSubmit={handleTransfer}
        canWrite={canWriteWarehouse}
      />
    </div>
  );
};

export default WarehouseWorkspace;

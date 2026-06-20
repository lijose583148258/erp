import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '../app/AppContext';
import { useUnsavedForm } from '../app/useUnsavedForm';
import { can } from '../app/permissions';
import { getModuleDescription, getModuleTitle } from '../components/navigation/moduleRegistry';
import { warehouseService, Warehouse as WarehouseType, StockBalanceRecord, StockEntryRecord, normalizeWarehouseRecord } from '../services/warehouse.service';
import { WarehouseCreateDialogs } from './warehouse/WarehouseCreateDialogs';
import { WarehouseInboundPanel } from './warehouse/WarehouseInboundPanel';
import { WarehouseInventoryPanel } from './warehouse/WarehouseInventoryPanel';
import { WarehouseLedgerPanel } from './warehouse/WarehouseLedgerPanel';
import { WarehouseOverviewPanel } from './warehouse/WarehouseOverviewPanel';
import { WarehouseTransferDialog } from './warehouse/WarehouseTransferDialog';
import { WarehouseWorkspaceTop } from './warehouse/WarehouseWorkspaceTop';
import { resolveWarehouseErrorMessage } from './warehouse/warehouseWorkspaceContent';
import {
  filterWarehouseLocations,
  flattenWarehouseLocations,
  summarizeWarehouses,
} from './warehouse/warehouseWorkspaceHelpers';
import {
  type InboundFormState,
  type InboundFormErrors,
  type InventoryFilterValues,
  type LocationCreateErrors,
  type LocationDraft,
  type StockBalanceQueryOverrides,
  type StockMeta,
  type TabKey,
  type TransferFormErrors,
  type TransferFormState,
  type WarehouseCreateErrors,
  type WarehouseDraft,
} from './warehouse/warehouseWorkspaceTypes';

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
  const [inboundErrors, setInboundErrors] = useState<InboundFormErrors>({});

  const [transferBalance, setTransferBalance] = useState<StockBalanceRecord | null>(null);
  const [transferForm, setTransferForm] = useState<TransferFormState>({ toLocationId: 0, quantity: 0, note: '' });
  const [transferErrors, setTransferErrors] = useState<TransferFormErrors>({});
  const [transferMsg, setTransferMsg] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);

  const [showCreateWarehouse, setShowCreateWarehouse] = useState(false);
  const [newWarehouse, setNewWarehouse] = useState<WarehouseDraft>({ code: '', name: '', type: 'physical' });
  const [warehouseCreateErrors, setWarehouseCreateErrors] = useState<WarehouseCreateErrors>({});
  const [warehouseCreating, setWarehouseCreating] = useState(false);
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const [newLocation, setNewLocation] = useState<LocationDraft>({ code: '', name: '', type: 'internal' });
  const [locationCreateErrors, setLocationCreateErrors] = useState<LocationCreateErrors>({});
  const [locationCreating, setLocationCreating] = useState(false);

  useUnsavedForm({
    sourceId: 'warehouse-inbound-form',
    label: '应急补录 / 盘盈入库',
    open: true,
    value: inboundForm,
  });

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

  const handleCreateWarehouse = async () => {
    if (warehouseCreating) return;
    if (!canWriteWarehouse) {
      notify('warning', '当前角色只能查看仓储数据，不能新建仓库');
      return;
    }
    const nextErrors: WarehouseCreateErrors = {};
    if (!newWarehouse.code.trim()) nextErrors.code = '请填写仓库编码';
    if (!newWarehouse.name.trim()) nextErrors.name = '请填写仓库名称';
    if (Object.keys(nextErrors).length) {
      setWarehouseCreateErrors(nextErrors);
      return;
    }
    setWarehouseCreateErrors({});
    setWarehouseCreating(true);
    try {
      const createdWarehouse = normalizeWarehouseRecord(await warehouseService.createWarehouse({
        ...newWarehouse,
        code: newWarehouse.code.trim(),
        name: newWarehouse.name.trim(),
      }));
      setSelectedWarehouse(createdWarehouse);
      setNewWarehouse({ code: '', name: '', type: 'physical' });
      setShowCreateWarehouse(false);
      await loadWarehouses();
    } catch (e: unknown) {
      notify('error', resolveWarehouseErrorMessage(e, '创建仓库失败'));
    } finally {
      setWarehouseCreating(false);
    }
  };

  const handleCreateLocation = async () => {
    if (locationCreating) return;
    if (!canWriteWarehouse) {
      notify('warning', '当前角色只能查看仓储数据，不能新建库位');
      return;
    }
    const nextErrors: LocationCreateErrors = {};
    if (!selectedWarehouse) nextErrors.warehouse = '请先选择要维护的仓库';
    if (!newLocation.code.trim()) nextErrors.code = '请填写库位编码';
    if (!newLocation.name.trim()) nextErrors.name = '请填写库位名称';
    if (Object.keys(nextErrors).length) {
      setLocationCreateErrors(nextErrors);
      return;
    }
    setLocationCreateErrors({});
    setLocationCreating(true);
    try {
      await warehouseService.createLocation(selectedWarehouse.id, {
        ...newLocation,
        code: newLocation.code.trim(),
        name: newLocation.name.trim(),
      });
      setNewLocation({ code: '', name: '', type: 'internal' });
      setShowCreateLocation(false);
      await loadWarehouses();
    } catch (e: unknown) {
      notify('error', resolveWarehouseErrorMessage(e, '创建库位失败'));
    } finally {
      setLocationCreating(false);
    }
  };

  const handleInbound = async () => {
    if (inboundSaving) return;
    if (!canWriteWarehouse) {
      setInboundMsg('当前角色只能查看仓储数据，不能执行应急补录 / 盘盈入库。');
      return;
    }
    const nextErrors: InboundFormErrors = {};
    if (!inboundForm.locationId) nextErrors.locationId = '请选择补录库位';
    if (!inboundForm.productName.trim()) nextErrors.productName = '请填写产品名称';
    if (!inboundForm.batchNo.trim()) nextErrors.batchNo = '请填写批次号';
    if (inboundForm.quantity <= 0) nextErrors.quantity = '补录数量必须大于 0';
    if (!inboundForm.sourceRef.trim()) nextErrors.sourceRef = '请填写来源单号';
    if (!inboundForm.reason.trim()) nextErrors.reason = '请选择明确原因';
    if (Object.keys(nextErrors).length) {
      setInboundErrors(nextErrors);
      setInboundMsg(Object.values(nextErrors)[0] || '请填写完整的应急补录 / 盘盈入库信息。本入口不能代替采购收货、生产入库或货抵入库。');
      return;
    }
    setInboundErrors({});
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
      setInboundErrors({});
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

  const { totalItems, totalQuantity, totalLocations } = summarizeWarehouses(warehouses);

  const allLocations = flattenWarehouseLocations(warehouses);
  const inventoryLocations = filterWarehouseLocations(allLocations, inventoryWarehouseId);
  const tabCounts = {
    warehouses: warehouses.length,
    stockBalances: stockBalances.length,
    stockTotal: stockMeta.total,
    stockEntries: stockEntries.length,
    locations: allLocations.length,
  };

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
    setTransferErrors({});
    setTransferMsg('');
  };

  const handleCloseTransfer = () => {
    if (transferSaving) return;
    setTransferBalance(null);
    setTransferForm({ toLocationId: 0, quantity: 0, note: '' });
    setTransferErrors({});
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
    const nextErrors: TransferFormErrors = {};
    if (!toLocationId) {
      nextErrors.toLocationId = '请选择目标库位';
      setTransferErrors(nextErrors);
      setTransferMsg(nextErrors.toLocationId);
      return;
    }
    if (toLocationId === Number(transferBalance.locationId)) {
      nextErrors.toLocationId = '目标库位不能和当前库位相同';
      setTransferErrors(nextErrors);
      setTransferMsg(nextErrors.toLocationId);
      return;
    }
    if (quantity <= 0) {
      nextErrors.quantity = '调拨数量必须大于 0';
      setTransferErrors(nextErrors);
      setTransferMsg(nextErrors.quantity);
      return;
    }
    if (quantity > Number(transferBalance.quantity || 0)) {
      nextErrors.quantity = '调拨数量不能超过当前库存';
      setTransferErrors(nextErrors);
      setTransferMsg(nextErrors.quantity);
      return;
    }

    setTransferErrors({});
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
      setTransferErrors({});
    } catch (e: unknown) {
      setTransferMsg(resolveWarehouseErrorMessage(e, '调拨失败'));
    } finally {
      setTransferSaving(false);
    }
  };

  return (
    <div
      className="space-y-6"
      data-complex-input-module="warehouse"
      data-complex-input-grid="<table inventory balances; ledger rows"
      data-complex-input-action="warehouse transfer; manual inbound; audit sourceRef; negative-stock guard"
      data-complex-input-readback="刷新库存台账; 回读库存流水; sourceRef evidence"
    >
      <WarehouseWorkspaceTop
        title={getModuleTitle('warehouse', language)}
        description={getModuleDescription('warehouse', language)}
        loading={loading}
        canWrite={canWriteWarehouse}
        activeTab={activeTab}
        canViewLedger={canViewLedger}
        counts={tabCounts}
        totalItems={totalItems}
        totalQuantity={totalQuantity}
        totalLocations={totalLocations}
        onRefresh={() => {
          void loadWarehouses();
          if (activeTab === 'inventory') queryInventory();
        }}
        onCreateWarehouse={() => {
          if (!canWriteWarehouse) {
            notify('warning', '当前角色只能查看仓储数据，不能新建仓库');
            return;
          }
          setWarehouseCreateErrors({});
          setShowCreateWarehouse(true);
        }}
        onTabChange={setActiveTab}
      />

      {activeTab === 'overview' && (
        <WarehouseOverviewPanel
          warehouses={warehouses}
          loading={loading}
          selectedWarehouse={selectedWarehouse}
          setSelectedWarehouse={setSelectedWarehouse}
          openCreateLocation={() => {
            if (!canWriteWarehouse) {
              notify('warning', '当前角色只能查看仓储数据，不能新建库位');
              return;
            }
            setLocationCreateErrors({});
            setShowCreateLocation(true);
          }}
          canWrite={canWriteWarehouse}
        />
      )}

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

      {activeTab === 'inbound' && (
        <WarehouseInboundPanel
          allLocations={allLocations}
          inboundForm={inboundForm}
          setInboundForm={setInboundForm}
          inboundErrors={inboundErrors}
          clearInboundError={(field) => setInboundErrors(prev => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
          })}
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
        warehouseErrors={warehouseCreateErrors}
        clearWarehouseError={field => setWarehouseCreateErrors(errors => ({ ...errors, [field]: undefined }))}
        warehouseCreating={warehouseCreating}
        handleCreateWarehouse={handleCreateWarehouse}
        showCreateLocation={showCreateLocation}
        setShowCreateLocation={setShowCreateLocation}
        selectedWarehouse={selectedWarehouse}
        newLocation={newLocation}
        setNewLocation={setNewLocation}
        locationErrors={locationCreateErrors}
        clearLocationError={field => setLocationCreateErrors(errors => ({ ...errors, [field]: undefined }))}
        locationCreating={locationCreating}
        handleCreateLocation={handleCreateLocation}
        canWrite={canWriteWarehouse}
      />
      <WarehouseTransferDialog
        balance={transferBalance}
        allLocations={allLocations}
        transferForm={transferForm}
        setTransferForm={setTransferForm}
        transferErrors={transferErrors}
        clearTransferError={(field) => setTransferErrors(prev => {
          if (!prev[field]) return prev;
          const next = { ...prev };
          delete next[field];
          return next;
        })}
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

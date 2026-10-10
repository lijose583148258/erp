import { ArrowDownLeft, ArrowUpRight, Filter, History, Package, Search } from 'lucide-react';
import type { StockEntryRecord, StockMovementRecord, Warehouse } from '../../services/warehouse.service';
import type { WarehouseLocationOption } from './warehouseWorkspaceTypes';

interface WarehouseLedgerPanelProps {
  warehouses: Warehouse[];
  allLocations: WarehouseLocationOption[];
  entries: StockEntryRecord[];
  loading: boolean;
  sourceType: string;
  setSourceType: (value: string) => void;
  productName: string;
  setProductName: (value: string) => void;
  batchNo: string;
  setBatchNo: (value: string) => void;
  sourceRef: string;
  setSourceRef: (value: string) => void;
  warehouseId: string;
  setWarehouseId: (value: string) => void;
  locationId: string;
  setLocationId: (value: string) => void;
  queryLedger: () => void;
}

const SOURCE_TYPE_OPTIONS = [
  { value: 'warehouse_transfer', label: '调拨记录' },
  { value: '', label: '全部库存流水' },
  { value: 'warehouse_manual_inbound', label: '手动入库' },
  { value: 'warehouse_adjustment', label: '库存调整' },
  { value: 'production_consumption', label: '生产耗用' },
  { value: 'production_output', label: '生产入库' },
  { value: 'procurement_receipt', label: '采购入库' },
  { value: 'shipping_issue', label: '销售出库' },
  { value: 'barter_receipt', label: '货抵入库' },
  { value: 'barter_issue', label: '货抵出库' },
];

const SOURCE_TYPE_LABELS = Object.fromEntries(SOURCE_TYPE_OPTIONS.map(item => [item.value, item.label]));

function formatNumber(value: number | string | null | undefined) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : '0';
}

function describeMovement(movement: StockMovementRecord) {
  const isOutbound = Number(movement.quantityDelta || 0) < 0;
  return {
    icon: isOutbound ? ArrowUpRight : ArrowDownLeft,
    tone: isOutbound
      ? 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300'
      : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
    directionLabel: isOutbound ? '扣减' : '增加',
  };
}

function summarizeTransfer(entry: StockEntryRecord) {
  const outbound = entry.movements.find(movement => Number(movement.quantityDelta || 0) < 0);
  const inbound = entry.movements.find(movement => Number(movement.quantityDelta || 0) > 0);
  if (!outbound || !inbound) return null;

  return {
    productName: outbound.productName || inbound.productName,
    batchNo: outbound.batchNo || inbound.batchNo,
    quantity: Math.abs(Number(outbound.quantityDelta || inbound.quantityDelta || 0)),
    unit: outbound.unit || inbound.unit || '',
    from: `${outbound.warehouseName || outbound.warehouseCode || '-'} / ${outbound.locationName || outbound.locationCode || '-'}`,
    to: `${inbound.warehouseName || inbound.warehouseCode || '-'} / ${inbound.locationName || inbound.locationCode || '-'}`,
  };
}

export function WarehouseLedgerPanel({
  warehouses,
  allLocations,
  entries,
  loading,
  sourceType,
  setSourceType,
  productName,
  setProductName,
  batchNo,
  setBatchNo,
  sourceRef,
  setSourceRef,
  warehouseId,
  setWarehouseId,
  locationId,
  setLocationId,
  queryLedger,
}: WarehouseLedgerPanelProps) {
  const filteredLocations = warehouseId
    ? allLocations.filter(location => String(location.warehouseId) === warehouseId)
    : allLocations;

  return (
    <div data-testid="warehouse-ledger-panel" className="space-y-4">
      <div className="rounded-[24px] border border-white/40 bg-white/70 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-gradient-to-br from-slate-800 to-slate-950 shadow-lg dark:from-amber-500 dark:to-orange-600">
            <History size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white">库存流水与调拨记录</h3>
            <p className="text-xs font-bold text-slate-400">从真实库存凭证读取，不是前端临时日志；支持按产品、批次、仓库、库位追溯。</p>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-4">
          {[
            { label: '来源类型', value: '区分调拨、手工入库、采购、生产、销售、货抵' },
            { label: '来源单号', value: '用 sourceRef 精确回读一次库存动作' },
            { label: '双边行', value: '调拨应同时出现扣减行和增加行' },
            { label: '净变动', value: '核对 movementCount 和 netQuantityDelta' },
          ].map(item => (
            <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/35">
              <p className="text-[11px] font-black tracking-[0.14em] text-slate-400">{item.label}</p>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-600 dark:text-slate-200">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-[180px_minmax(220px,1fr)_170px] 2xl:grid-cols-[180px_minmax(260px,1fr)_170px_190px_190px_220px_auto]">
          <select
            data-testid="warehouse-ledger-source-type-select"
            value={sourceType}
            onChange={event => setSourceType(event.target.value)}
            className="rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl focus:ring-2 focus:ring-amber-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white"
          >
            {SOURCE_TYPE_OPTIONS.map(option => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-2 rounded-2xl border border-white/40 bg-white/80 px-5 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70">
            <Search size={18} className="text-slate-400" />
            <input
              data-testid="warehouse-ledger-product-search"
              value={productName}
              onChange={event => setProductName(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && queryLedger()}
              placeholder="搜索产品名称..."
              className="w-full border-none bg-transparent text-sm font-bold text-slate-800 placeholder:text-slate-300 focus:ring-0 dark:text-white"
            />
          </div>

          <input
            data-testid="warehouse-ledger-batch-search"
            value={batchNo}
            onChange={event => setBatchNo(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && queryLedger()}
            placeholder="批次号"
            className="rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl focus:ring-2 focus:ring-amber-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white"
          />

          <input
            data-testid="warehouse-ledger-source-ref-search"
            value={sourceRef}
            onChange={event => setSourceRef(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && queryLedger()}
            placeholder="来源单号/工单号"
            className="rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl focus:ring-2 focus:ring-amber-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white"
          />

          <select
            data-testid="warehouse-ledger-warehouse-select"
            value={warehouseId}
            onChange={event => {
              setWarehouseId(event.target.value);
              setLocationId('');
            }}
            className="rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl focus:ring-2 focus:ring-amber-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white"
          >
            <option value="">全部仓库</option>
            {warehouses.map(warehouse => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
            ))}
          </select>

          <select
            data-testid="warehouse-ledger-location-select"
            value={locationId}
            onChange={event => setLocationId(event.target.value)}
            className="rounded-2xl border border-white/40 bg-white/80 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl focus:ring-2 focus:ring-amber-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white"
          >
            <option value="">全部库位</option>
            {filteredLocations.map(location => (
              <option key={location.id} value={location.id}>{location.warehouseName} / {location.name}</option>
            ))}
          </select>

          <button
            data-testid="warehouse-ledger-query-button"
            type="button"
            onClick={queryLedger}
 className="flex items-center justify-center gap-2 rounded-2xl bg-blue-50 px-5 py-3 text-sm font-black text-blue-600 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none hover:bg-blue-100 dark:bg-blue-900/30"
          >
            <Filter size={16} />
            查询
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-white/40 bg-white/70 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70">
        {loading ? (
          <div className="p-10 text-center text-sm font-bold text-slate-400">库存流水加载中...</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Package size={34} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm font-bold">暂无匹配的库存流水</p>
            <p className="mt-1 text-xs">可以切换到“全部库存流水”或放宽产品/批次过滤。</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map(entry => {
              const transfer = summarizeTransfer(entry);
              return (
                <div key={entry.id} data-testid={`warehouse-ledger-row-${entry.id}`} className="p-5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white dark:bg-white dark:text-slate-900">{entry.entryNo}</span>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          {SOURCE_TYPE_LABELS[entry.sourceType] || entry.sourceType}
                        </span>
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{entry.status}</span>
                        <span className="text-xs font-bold text-slate-400">{entry.postedAt ? new Date(entry.postedAt).toLocaleString('zh-CN') : '-'}</span>
                      </div>
                      {transfer ? (
                        <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
                          <p className="text-sm font-black text-slate-900 dark:text-white">{transfer.productName}</p>
                          <p className="mt-1 text-xs font-bold text-slate-500">批次 {transfer.batchNo} 路 {formatNumber(transfer.quantity)} {transfer.unit}</p>
                          <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">
                            {transfer.from}
                            <span className="mx-2 text-amber-500">→</span>
                            {transfer.to}
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {entry.movements.map(movement => {
                            const info = describeMovement(movement);
                            const MovementIcon = info.icon;
                            return (
                              <div key={movement.id} className="rounded-2xl border border-slate-100 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                                <div className="mb-2 flex items-center gap-2">
                                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-xl ${info.tone}`}>
                                    <MovementIcon size={14} />
                                  </span>
                                  <span className="text-xs font-black text-slate-500">{info.directionLabel}</span>
                                  <span className="text-xs font-black text-slate-900 dark:text-white">{formatNumber(Math.abs(Number(movement.quantityDelta || 0)))} {movement.unit}</span>
                                </div>
                                <p className="truncate text-sm font-black text-slate-800 dark:text-white">{movement.productName}</p>
                                <p className="mt-1 text-xs font-bold text-slate-400">{movement.batchNo}</p>
                                <p className="mt-2 text-xs font-bold text-slate-500">{movement.warehouseName || movement.warehouseCode || '-'} / {movement.locationName || movement.locationCode || '-'}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="w-full rounded-2xl bg-slate-50 p-4 text-xs dark:bg-slate-800/40 xl:w-72">
                      <p className="font-black uppercase tracking-wider text-slate-400">来源单据</p>
                      <p className="mt-1 break-all font-mono text-slate-600 dark:text-slate-300">{entry.sourceRef || '-'}</p>
                      <p className="mt-3 font-black uppercase tracking-wider text-slate-400">备注</p>
                      <p className="mt-1 font-bold text-slate-600 dark:text-slate-300">{entry.note || entry.reason || '-'}</p>
                      <p className="mt-3 font-black uppercase tracking-wider text-slate-400">行数 / 净变动</p>
                      <p className="mt-1 font-black text-slate-900 dark:text-white">{entry.movementCount} 行 / {formatNumber(entry.netQuantityDelta)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

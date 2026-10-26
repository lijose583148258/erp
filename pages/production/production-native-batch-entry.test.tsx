// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ProductionBom, ProductionWorkOrder } from '../../services/production.service';
import type { ProductBatch } from '../../services/asset.service';

const context = vi.hoisted(() => ({
  user: { id: 'operator-1', role: 'operator', permissions: ['production.read', 'production.execute'] },
  notify: vi.fn(), registerUnsavedChanges: vi.fn(), confirmDiscardChanges: vi.fn(() => true),
}));
vi.mock('../../app/AppContext', () => ({ useAppContext: () => ({ currentUser: context.user, language: 'zh',
  notify: context.notify, registerUnsavedChanges: context.registerUnsavedChanges, confirmDiscardChanges: context.confirmDiscardChanges }) }));
vi.mock('../../services/asset.service', () => ({ assetService: { getBatches: vi.fn() } }));
vi.mock('../../services/adjustment.service', () => ({ adjustmentService: { getAll: vi.fn() } }));
vi.mock('../../services/production.service', () => ({ productionService: {
  getSummary: vi.fn(), getBoms: vi.fn(), getWorkOrders: vi.fn(), createWorkOrder: vi.fn(), getWorkOrderDispositions: vi.fn(), createWorkOrderDisposition: vi.fn(),
} }));
vi.mock('../../services/warehouse.service', () => ({ warehouseService: { listStockBalances: vi.fn(), listWarehouses: vi.fn() } }));
vi.mock('./DensityWorkbench', () => ({ DensityWorkbench: () => null }));
vi.mock('./DensityConversionWorkbench', () => ({ DensityConversionWorkbench: () => null }));
vi.mock('./PackagingWorkbench', () => ({ PackagingWorkbench: () => null }));
vi.mock('./ProductionWorkspaceModals', () => ({ ProductionWorkspaceModals: () => null }));
vi.mock('./ProductionQualityInspectionPanel', () => ({ ProductionQualityInspectionPanel: () => null }));
vi.mock('./ProductionBatchGenealogy', () => ({ ProductionBatchGenealogy: ({ batchId }: { batchId: number }) => <div data-testid="genealogy-request">{batchId}</div> }));

import { assetService } from '../../services/asset.service';
import { productionService } from '../../services/production.service';
import { warehouseService } from '../../services/warehouse.service';
import { useProductionWorkspaceData } from './useProductionWorkspaceData';
import { buildBatchTrace } from './ProductionWorkspaceDerived';
import ProductionWorkspaceV2 from '../ProductionWorkspaceV2';

const order = (id: number, batchId: number, overrides: Partial<ProductionWorkOrder> = {}): ProductionWorkOrder => ({
  id, workOrderNo: `WO-${id}`, bomId: null, batchId, productName: 'Same-name product', targetQuantity: 10, producedQuantity: 10,
  lossQuantity: 0, status: 'completed', plannedStartAt: null, plannedEndAt: null, actualStartAt: null, actualEndAt: null,
  note: null, createdBy: 1, steps: [], qualityChecks: [], createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z',
  productBatch: { id: batchId, batchNo: `LOT-${batchId}`, productName: 'Same-name product', productionDate: null, expiryDate: null,
    stockQuantity: 10, unit: 'kg', isColdChain: true, storageTemp: '2–8 °C', qualityStatus: 'released' }, ...overrides,
});
const asset: ProductBatch = { id: 99, batchNo: 'ASSET-99', productName: 'Asset-only product', productionDate: '2026-10-17',
  expiryDate: '2027-10-17', isColdChain: false, storageTemp: null, stockQuantity: 5, unit: 'kg' };
const stock = (batchId: number) => ({ id: batchId * 10, locationId: 1, productName: 'Same-name product', batchNo: `LOT-${batchId}`,
  quantity: 10, unit: 'kg', lastMoveAt: null, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z', locationName: `Location-${batchId}` });
const stockPage = (batchId: number) => ({ data: [stock(batchId)], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });

beforeEach(() => {
  vi.resetAllMocks();
  context.user = { id: 'operator-1', role: 'operator', permissions: ['production.read', 'production.execute'] };
  context.confirmDiscardChanges.mockReturnValue(true);
  vi.mocked(productionService.getSummary).mockResolvedValue({ bomCount: 0, workOrderCount: 2, batchCount: 2, activeWorkOrders: 0,
    completedWorkOrders: 2, qcPendingCount: 0, totalTargetQuantity: 20, totalProducedQuantity: 20, totalLossQuantity: 0,
    passCount: 0, failCount: 0, recentWorkOrders: [] });
  vi.mocked(productionService.getBoms).mockResolvedValue([]);
  vi.mocked(productionService.getWorkOrders).mockResolvedValue([order(1, 11), order(2, 22)]);
  vi.mocked(assetService.getBatches).mockResolvedValue([asset]);
  vi.mocked(productionService.getWorkOrderDispositions).mockResolvedValue([]);
  vi.mocked(warehouseService.listStockBalances).mockResolvedValue({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 1 } });
  vi.mocked(warehouseService.listWarehouses).mockResolvedValue([]);
});
afterEach(cleanup);

describe('native BOM version selection when creating work orders', () => {
  const bom = (id: number, version: string, productName = 'Same-name product'): ProductionBom => ({
    id, bomNo: `BOM-${id}`, productName, version, outputUnit: 'kg', shelfLifeDays: null, notes: null,
    createdBy: 1, items: [], qualityCharacteristics: [], createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z',
  });

  beforeEach(() => {
    context.user.permissions.push('production.plan.write');
    vi.mocked(productionService.createWorkOrder).mockResolvedValue(order(3, 33, { status: 'draft' }));
  });

  it('keeps an explicitly selected older version instead of the first same-product BOM', async () => {
    vi.mocked(productionService.getBoms).mockResolvedValue([bom(2, 'v2'), bom(1, 'v1')]);
    render(<ProductionWorkspaceV2 />);
    const olderRow = await screen.findByRole('row', { name: /BOM-1.*v1/ });
    fireEvent.click(within(olderRow).getByRole('button', { name: '选中回读/带入工单' }));
    expect(screen.getByTestId('production-bom-readback').textContent).toContain('BOM-1 / v1');
    fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    expect((screen.getByTestId('production-work-order-product-name') as HTMLInputElement).value).toBe('Same-name product');
    fireEvent.change(screen.getByTestId('production-work-order-target-quantity'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('production-work-order-save'));
    await waitFor(() => expect(productionService.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({
      bomId: 1, productName: 'Same-name product', targetQuantity: 10,
    })));
  });

  it('still finds the matching product BOM when the default selected BOM belongs to another product', async () => {
    vi.mocked(productionService.getBoms).mockResolvedValue([bom(9, 'v1', 'Other product'), bom(2, 'v2'), bom(1, 'v1')]);
    render(<ProductionWorkspaceV2 />);
    await waitFor(() => expect(screen.getByTestId('production-bom-readback').textContent).toContain('BOM-9 / v1'));
    fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    fireEvent.change(screen.getByTestId('production-work-order-product-name'), { target: { value: 'Same-name product' } });
    fireEvent.change(screen.getByTestId('production-work-order-target-quantity'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('production-work-order-save'));
    await waitFor(() => expect(productionService.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({
      bomId: 2, productName: 'Same-name product', targetQuantity: 10,
    })));
  });

  it('still creates an unbound work order when there is no selected or matching BOM', async () => {
    render(<ProductionWorkspaceV2 />);
    fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.getByTestId('production-work-order-save').hasAttribute('disabled')).toBe(false));
    fireEvent.change(screen.getByTestId('production-work-order-product-name'), { target: { value: 'New product' } });
    fireEvent.change(screen.getByTestId('production-work-order-target-quantity'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('production-work-order-save'));
    await waitFor(() => expect(productionService.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({
      bomId: undefined, productName: 'New product', targetQuantity: 10,
    })));
  });
});

describe('production work-order batch selection boundary', () => {
  it('requires an explicit work-order and batch identity without loading or synthesizing an asset catalog', async () => {
    const { result } = renderHook(() => useProductionWorkspaceData(context.notify));
    await waitFor(() => expect(result.current.workOrders).toHaveLength(2));
    expect(result.current.batches).toEqual([]); expect(result.current.selectedBatch).toBeNull();
    act(() => { expect(result.current.selectWorkOrderBatch(1, 22)).toBe(false); });
    expect(result.current.selectedBatch).toBeNull();
    act(() => { expect(result.current.selectWorkOrderBatch(1, 11)).toBe(true); });
    expect(result.current.selectedBatch).toMatchObject({ id: 11, isColdChain: true, storageTemp: '2–8 °C', productionDate: null, expiryDate: null });
    expect(result.current.batches).toEqual([]); expect(assetService.getBatches).not.toHaveBeenCalled();
    act(() => result.current.setSelectedWorkOrderId(2));
    expect(result.current.selectedBatch).toBeNull();
  });

  it('invalidates an explicit pair when refresh removes or replaces the work-order batch, rather than using a same-name batch', async () => {
    const { result } = renderHook(() => useProductionWorkspaceData(context.notify));
    await waitFor(() => expect(result.current.workOrders).toHaveLength(2));
    act(() => result.current.selectWorkOrderBatch(1, 11));
    vi.mocked(productionService.getWorkOrders).mockResolvedValueOnce([order(1, 33), order(2, 11)]);
    await act(async () => result.current.loadData());
    expect(result.current.selectedBatch).toBeNull(); expect(result.current.selectedBatchId).toBeNull();
    expect(result.current.selectedBatchWorkOrder).toBeNull();
  });

  it('preserves the authorized asset-list selection and allows switching back from a work-order batch', async () => {
    context.user.permissions.push('assets.read');
    const { result } = renderHook(() => useProductionWorkspaceData(context.notify));
    await waitFor(() => expect(result.current.batches).toEqual([asset]));
    act(() => result.current.setSelectedBatchId(99));
    expect(result.current.selectedBatch).toEqual(asset);
    act(() => result.current.selectWorkOrderBatch(1, 11));
    expect(result.current.selectedBatch?.id).toBe(11);
    act(() => result.current.setSelectedBatchId(99));
    expect(result.current.selectedBatch).toEqual(asset); expect(result.current.selectedBatchWorkOrder).toBeNull();
  });

  it('does not carry a chosen batch into another actor session or a late response from the old actor', async () => {
    const { result, rerender } = renderHook(() => useProductionWorkspaceData(context.notify));
    await waitFor(() => expect(result.current.workOrders).toHaveLength(2));
    act(() => result.current.selectWorkOrderBatch(1, 11));
    let resolveOld!: (rows: ProductionWorkOrder[]) => void;
    vi.mocked(productionService.getWorkOrders).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    let oldRefresh!: Promise<void>;
    act(() => { oldRefresh = result.current.loadData(); });
    context.user = { ...context.user, id: 'operator-2' };
    vi.mocked(productionService.getWorkOrders).mockResolvedValueOnce([order(3, 33)]);
    rerender();
    expect(result.current.selectedBatch).toBeNull();
    expect(result.current.workOrders).toEqual([]);
    act(() => { expect(result.current.selectWorkOrderBatch(1, 11)).toBe(false); });
    await waitFor(() => expect(result.current.workOrders.map(row => row.id)).toEqual([3]));
    await act(async () => { resolveOld([order(1, 11)]); await oldRefresh; });
    expect(result.current.workOrders.map(row => row.id)).toEqual([3]);
    expect(result.current.selectedBatch).toBeNull();
  });

  it('does not restore an invalidated selection from an older concurrent refresh', async () => {
    const { result } = renderHook(() => useProductionWorkspaceData(context.notify));
    await waitFor(() => expect(result.current.workOrders).toHaveLength(2));
    act(() => result.current.selectWorkOrderBatch(1, 11));
    let resolveOld!: (rows: ProductionWorkOrder[]) => void;
    vi.mocked(productionService.getWorkOrders).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce([order(1, 33)]);
    let oldRefresh!: Promise<void>;
    act(() => { oldRefresh = result.current.loadData(); });
    await act(async () => result.current.loadData());
    expect(result.current.selectedBatch).toBeNull();
    await act(async () => { resolveOld([order(1, 11)]); await oldRefresh; });
    expect(result.current.workOrders[0].batchId).toBe(33); expect(result.current.selectedBatch).toBeNull();
  });
});

describe('native work-order batch desk', () => {
  it('opens the real pair beside the batch tag, reuses genealogy/dispositions, and leaves the full catalog hidden', async () => {
    render(<ProductionWorkspaceV2 />);
    fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-batch-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('production-work-order-batch-1'));
    expect(screen.getByTestId('production-desk-batches').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('genealogy-request').textContent).toBe('11');
    expect(screen.getByTestId('production-batch-work-order-context').textContent).toContain('WO-1');
    expect(screen.queryByTestId('production-batch-search-input')).toBeNull();
    expect(screen.queryByTestId('production-batch-row-99')).toBeNull();
    expect(screen.getByText(/冷链 是/)).toBeTruthy();
    await waitFor(() => expect(productionService.getWorkOrderDispositions).toHaveBeenCalledWith(1));
    expect(assetService.getBatches).not.toHaveBeenCalled();
  });

  it('does not bypass the existing unsaved-change decision when opening a batch or leaving its desk', async () => {
    render(<ProductionWorkspaceV2 />); fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-batch-1')).toBeTruthy());
    context.confirmDiscardChanges.mockReturnValue(false);
    fireEvent.click(screen.getByTestId('production-work-order-batch-1'));
    expect(screen.getByTestId('production-desk-work-orders').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('genealogy-request')).toBeNull();
    context.confirmDiscardChanges.mockReturnValue(true); fireEvent.click(screen.getByTestId('production-work-order-batch-1'));
    fireEvent.change(screen.getByTestId('production-adjustment-quantity-input'), { target: { value: '2' } });
    await waitFor(() => expect(context.registerUnsavedChanges).toHaveBeenCalledWith('production-batch-adjustment-form', expect.any(String), true));
    context.confirmDiscardChanges.mockReturnValue(false); fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    expect(screen.getByTestId('production-desk-batches').getAttribute('aria-selected')).toBe('true');
  });

  it('keeps incomplete work orders traceable but unable to load or post a production disposition', async () => {
    vi.mocked(productionService.getWorkOrders).mockResolvedValue([order(1, 11, { status: 'in_progress' }), order(2, 11)]);
    render(<ProductionWorkspaceV2 />); fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-batch-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('production-work-order-batch-1'));
    expect(screen.getByTestId('production-adjustment-save').hasAttribute('disabled')).toBe(true);
    expect(productionService.getWorkOrderDispositions).not.toHaveBeenCalled();
    expect(productionService.createWorkOrderDisposition).not.toHaveBeenCalled();
    expect(screen.getByTestId('production-batch-work-order-context').textContent).toContain('WO-1');
    expect(screen.queryByText('工单 WO-2')).toBeNull();
  });

  it('does not offer a batch action for a missing or inconsistent output identity', async () => {
    vi.mocked(productionService.getWorkOrders).mockResolvedValue([order(1, 11, { batchId: null, productBatch: null })]);
    render(<ProductionWorkspaceV2 />); fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-row-1')).toBeTruthy());
    expect(screen.queryByTestId('production-work-order-batch-1')).toBeNull();
    fireEvent.click(screen.getByTestId('production-desk-batches'));
    expect(screen.queryByTestId('production-adjustment-save')).toBeNull();
    expect(productionService.getWorkOrderDispositions).not.toHaveBeenCalled();
  });

  it('retains the existing asset rows, search and selection for an authorized asset reader', async () => {
    context.user.permissions.push('assets.read'); render(<ProductionWorkspaceV2 />);
    fireEvent.click(screen.getByTestId('production-desk-batches'));
    await waitFor(() => expect(screen.queryByTestId('production-batch-row-99')).toBeTruthy());
    expect(screen.getByTestId('production-batch-search-input')).toBeTruthy();
    fireEvent.click(screen.getByTestId('production-batch-row-99'));
    expect(screen.getByTestId('genealogy-request').textContent).toBe('99');
  });

  it('does not let an old actor disposition response refill a new actor selected batch', async () => {
    let resolveOld!: (rows: Awaited<ReturnType<typeof warehouseService.listStockBalances>>) => void;
    vi.mocked(warehouseService.listStockBalances).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const view = render(<ProductionWorkspaceV2 />); fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-batch-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('production-work-order-batch-1'));
    await waitFor(() => expect(warehouseService.listStockBalances).toHaveBeenCalledTimes(1));
    context.user = { ...context.user, id: 'operator-2' };
    vi.mocked(productionService.getWorkOrders).mockResolvedValue([order(3, 33)]);
    view.rerender(<ProductionWorkspaceV2 />);
    expect(screen.queryByTestId('production-adjustment-save')).toBeNull();
    fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-batch-3')).toBeTruthy());
    fireEvent.click(screen.getByTestId('production-work-order-batch-3'));
    await waitFor(() => expect(productionService.getWorkOrderDispositions).toHaveBeenCalledWith(3));
    await act(async () => resolveOld(stockPage(11)));
    expect(screen.getByTestId('genealogy-request').textContent).toBe('33');
    expect(screen.queryByText(/Location-11/)).toBeNull();
    expect(screen.getByTestId('production-disposition-stock-balance').querySelectorAll('option')).toHaveLength(1);
  });

  it('reuses the existing disposition submission and stable retry key for the explicitly chosen work order', async () => {
    vi.mocked(warehouseService.listStockBalances).mockResolvedValue(stockPage(22));
    vi.mocked(productionService.createWorkOrderDisposition).mockRejectedValue(new Error('controlled transport failure'));
    render(<ProductionWorkspaceV2 />); fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-row-2')).toBeTruthy());
    fireEvent.click(screen.getByTestId('production-work-order-row-2'));
    fireEvent.click(screen.getByTestId('production-work-order-batch-2'));
    await waitFor(() => expect((screen.getByTestId('production-disposition-stock-balance') as HTMLSelectElement).value).toBe('220'));
    fireEvent.change(screen.getByTestId('production-adjustment-quantity-input'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('production-adjustment-save'));
    await waitFor(() => expect(context.notify).toHaveBeenCalledWith('error', 'controlled transport failure'));
    fireEvent.click(screen.getByTestId('production-adjustment-save'));
    await waitFor(() => expect(productionService.createWorkOrderDisposition).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(productionService.createWorkOrderDisposition).mock.calls;
    expect(calls[0]).toEqual([2, expect.objectContaining({ type: 'scrap', quantity: 2, stockBalanceId: 220, idempotencyKey: expect.any(String) })]);
    expect(calls[1]).toEqual(calls[0]);
  });

  it.each(['research', 'cost'])('lets a read-only %s inspect its selected work-order batch without asset or disposition lookup calls', async role => {
    context.user = { id: `${role}-1`, role, permissions: ['production.read'] };
    render(<ProductionWorkspaceV2 />); fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-batch-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('production-work-order-batch-1'));
    expect(screen.getByTestId('genealogy-request').textContent).toBe('11');
    expect(screen.queryByTestId('production-adjustment-save')).toBeNull();
    expect(assetService.getBatches).not.toHaveBeenCalled();
    expect(warehouseService.listStockBalances).not.toHaveBeenCalled();
    expect(warehouseService.listWarehouses).not.toHaveBeenCalled();
    expect(productionService.getWorkOrderDispositions).not.toHaveBeenCalled();
  });
});

describe('nullable production batch dates', () => {
  it('does not invent a non-cold-chain fact when an older API omits the flag', async () => {
    const older = order(1, 11);
    delete (older.productBatch as Partial<ProductBatch>).isColdChain;
    vi.mocked(productionService.getWorkOrders).mockResolvedValue([older]);
    render(<ProductionWorkspaceV2 />); fireEvent.click(screen.getByTestId('production-desk-work-orders'));
    await waitFor(() => expect(screen.queryByTestId('production-work-order-batch-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('production-work-order-batch-1'));
    expect(screen.getByText(/冷链 未提供/)).toBeTruthy();
  });

  it('never invents 1970 dates or expiry events for absent business facts', () => {
    const batch = order(1, 11).productBatch!;
    const trace = buildBatchTrace(batch, []);
    expect(trace).toEqual([]);
    expect(buildBatchTrace(batch, [order(1, 11)]).map(node => node.label)).toEqual(['工单创建']);
  });

  it('preserves the original trace for dated asset batches', () => {
    const trace = buildBatchTrace(asset, []);
    expect(trace.map(node => node.label)).toEqual(['批次日期（非工单完工凭证）', '效期管控']);
    expect(trace.map(node => node.time.toISOString())).toEqual(['2026-10-17T00:00:00.000Z', '2027-10-17T00:00:00.000Z']);
  });
});

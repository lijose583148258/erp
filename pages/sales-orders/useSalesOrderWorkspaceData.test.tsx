// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
const context = vi.hoisted(() => ({ user: { id: 'sales-a', role: 'sales', permissions: ['orders.read', 'customers.read'], dataScopes: ['own_customers'] } }));
vi.mock('../../app/AppContext', () => ({ useAppContext: () => ({ currentUser: context.user }) }));
vi.mock('../../services/asset.service', () => ({ assetService: { getBatches: vi.fn() } }));
vi.mock('../../services/contract.service', () => ({ contractService: { getContracts: vi.fn() } }));
vi.mock('../../src/services/customer.service', () => ({ customerService: { getPage: vi.fn() } }));
vi.mock('../../src/services/order.service', () => ({ orderService: { getPage: vi.fn(), getById: vi.fn() } }));
import { assetService } from '../../services/asset.service';
import { contractService } from '../../services/contract.service';
import { customerService } from '../../src/services/customer.service';
import { orderService } from '../../src/services/order.service';
import { serverStateClient } from '../../app/serverState';
import { useSalesOrderWorkspaceData } from './useSalesOrderWorkspaceData';
import SalesOrderHeaderForm from './SalesOrderHeaderForm';
import type { SalesOrder } from '../../types';

const page = { rows: [], page: 1, pageSize: 30, total: 0, totalPages: 1 };
const batch = (label: string): Awaited<ReturnType<typeof assetService.getBatches>>[number] => ({ id: label === 'batch-b' ? 2 : 1,
    batchNo: label, productName: 'Resin', productionDate: '2026-10-16', expiryDate: '2027-10-16', isColdChain: false, stockQuantity: 10, unit: 'kg' });
const grants = () => { context.user.permissions = ['orders.read', 'customers.read', 'contracts.read', 'assets.read']; };
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function hook(selectedOrder: SalesOrder | null = null) {
    const notify = vi.fn(), setSelectedOrder = vi.fn();
    return { notify, setSelectedOrder, ...renderHook(() => useSalesOrderWorkspaceData({ notify, t: {}, selectedOrder, setSelectedOrder })) };
}

describe('sales optional lookup least-privilege boundary', () => {
    beforeEach(() => {
        vi.resetAllMocks(); serverStateClient.clear();
        context.user = { id: 'sales-a', role: 'sales', permissions: ['orders.read', 'customers.read'], dataScopes: ['own_customers'] };
        vi.mocked(orderService.getPage).mockResolvedValue(page);
        vi.mocked(customerService.getPage).mockResolvedValue(page);
        vi.mocked(contractService.getContracts).mockResolvedValue({ contracts: [{ id: 'contract-a' }], meta: null });
        vi.mocked(assetService.getBatches).mockResolvedValue([batch('batch-a')]);
    });
    afterEach(() => { cleanup(); serverStateClient.clear(); });

    it('does not request optional contracts/assets or warn when resolved permissions exclude them', async () => {
        const { result, notify } = hook();
        await waitFor(() => expect(orderService.getPage).toHaveBeenCalledTimes(1));
        await act(async () => {});
        expect(customerService.getPage).toHaveBeenCalledTimes(1);
        expect(contractService.getContracts).not.toHaveBeenCalled();
        expect(assetService.getBatches).not.toHaveBeenCalled();
        expect(result.current.contracts).toEqual([]); expect(result.current.batches).toEqual([]);
        expect(notify).not.toHaveBeenCalled();
    });

    it('still loads optional data for authorized users', async () => {
        grants(); const { result } = hook();
        await waitFor(() => expect(result.current.contracts).toEqual([{ id: 'contract-a' }]));
        expect(result.current.batches).toEqual([batch('batch-a')]);
        expect(contractService.getContracts).toHaveBeenCalledExactlyOnceWith({ status: 'active' });
        expect(assetService.getBatches).toHaveBeenCalledTimes(1);
    });

    it('clears loaded sensitive data immediately when permissions are revoked', async () => {
        grants(); const { result, rerender } = hook();
        await waitFor(() => expect(result.current.contracts).toHaveLength(1));
        context.user.permissions = ['orders.read', 'customers.read']; rerender();
        expect(result.current.contracts).toEqual([]); expect(result.current.batches).toEqual([]);
        await act(async () => {});
        expect(contractService.getContracts).toHaveBeenCalledTimes(1); expect(assetService.getBatches).toHaveBeenCalledTimes(1);
    });

    it('does not let requests begun before revocation refill optional data', async () => {
        grants(); const contracts = deferred<Awaited<ReturnType<typeof contractService.getContracts>>>();
        const batches = deferred<Awaited<ReturnType<typeof assetService.getBatches>>>();
        vi.mocked(contractService.getContracts).mockReturnValueOnce(contracts.promise);
        vi.mocked(assetService.getBatches).mockReturnValueOnce(batches.promise);
        const { result, rerender, notify } = hook();
        context.user.permissions = ['orders.read', 'customers.read']; rerender();
        await act(async () => { contracts.resolve({ contracts: [{ id: 'old-sensitive-contract' }], meta: null }); batches.resolve([batch('old-sensitive-batch')]); });
        expect(result.current.contracts).toEqual([]); expect(result.current.batches).toEqual([]);
        expect(contractService.getContracts).toHaveBeenCalledTimes(1); expect(assetService.getBatches).toHaveBeenCalledTimes(1);
        expect(notify).not.toHaveBeenCalled();
    });

    it('isolates same-permission actors and discards a previous actor response', async () => {
        grants(); const old = deferred<Awaited<ReturnType<typeof contractService.getContracts>>>();
        vi.mocked(contractService.getContracts).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ contracts: [{ id: 'contract-b' }], meta: null });
        vi.mocked(assetService.getBatches).mockResolvedValueOnce([batch('batch-a')]).mockResolvedValueOnce([batch('batch-b')]);
        const { result, rerender } = hook();
        context.user = { ...context.user, id: 'sales-b' }; rerender();
        await waitFor(() => expect(result.current.contracts).toEqual([{ id: 'contract-b' }]));
        await act(async () => old.resolve({ contracts: [{ id: 'old-contract-a' }], meta: null }));
        expect(result.current.contracts).toEqual([{ id: 'contract-b' }]); expect(result.current.batches).toEqual([batch('batch-b')]);
        expect(orderService.getPage).toHaveBeenCalledTimes(2); expect(contractService.getContracts).toHaveBeenCalledTimes(2);
    });

    it.each(['contracts', 'assets', 'orders'] as const)('retains a real warning when an authorized %s request fails', async kind => {
        grants();
        if (kind === 'contracts') vi.mocked(contractService.getContracts).mockRejectedValueOnce(new Error('real contract outage'));
        if (kind === 'assets') vi.mocked(assetService.getBatches).mockRejectedValueOnce(new Error('real asset outage'));
        if (kind === 'orders') vi.mocked(orderService.getPage).mockRejectedValueOnce(new Error('real order outage'));
        const { notify } = hook();
        await waitFor(() => expect(notify).toHaveBeenCalledWith('warning', expect.stringContaining('部分数据加载失败')));
    });

    it('does not warn in the next actor session about an old actor lookup failure', async () => {
        grants(); const old = deferred<Awaited<ReturnType<typeof contractService.getContracts>>>();
        vi.mocked(contractService.getContracts).mockReturnValueOnce(old.promise);
        const { rerender, notify } = hook();
        context.user.permissions = ['orders.read', 'customers.read']; rerender();
        await act(async () => old.reject(new Error('old-session failed')));
        expect(notify).not.toHaveBeenCalled();
    });

    it('preserves an existing selection on mount but rejects old detail and refresh results after actor change', async () => {
        const order = { id: 'old-order' } as SalesOrder;
        const first = deferred<SalesOrder>(), second = deferred<SalesOrder>();
        vi.mocked(orderService.getById).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result, rerender, setSelectedOrder, notify } = hook(order);
        expect(setSelectedOrder).not.toHaveBeenCalled();
        let hydrate!: ReturnType<typeof result.current.hydrateOrderDetail>, refresh!: ReturnType<typeof result.current.refreshSelectedOrder>;
        act(() => { hydrate = result.current.hydrateOrderDetail(order); refresh = result.current.refreshSelectedOrder(); });
        context.user = { ...context.user, id: 'sales-b' }; rerender();
        expect(setSelectedOrder).toHaveBeenCalledExactlyOnceWith(null); setSelectedOrder.mockClear();
        await act(async () => { first.resolve(order); second.resolve(order); expect(await hydrate).toBeNull(); expect(await refresh).toBeNull(); });
        expect(result.current.orders).toEqual([]); expect(setSelectedOrder).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
    });

    it('suppresses only stale detail failures, while current-actor failures still warn and use the existing snapshot', async () => {
        const order = { id: 'old-order' } as SalesOrder, old = deferred<SalesOrder>();
        vi.mocked(orderService.getById).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('current detail outage'));
        const { result, rerender, notify } = hook();
        let detail!: ReturnType<typeof result.current.hydrateOrderDetail>;
        act(() => { detail = result.current.hydrateOrderDetail(order); });
        context.user = { ...context.user, id: 'sales-b' }; rerender();
        await act(async () => { old.reject(new Error('old detail outage')); expect(await detail).toBeNull(); });
        expect(notify).not.toHaveBeenCalled();
        await act(async () => expect(await result.current.hydrateOrderDetail(order)).toEqual(order));
        expect(notify).toHaveBeenCalledWith('warning', expect.stringContaining('订单详情拉取失败'));
    });

    it('hides the contract selector without permission even if stale contracts were passed by a caller', () => {
        const props = { language: 'zh' as const, t: {}, customers: [], contracts: [{ id: 'secret', title: 'Sensitive contract', contractNo: 'SECRET' }],
            formData: { customerId: '', contractId: '', notes: '', paymentTermsDays: 30, taxInclusive: false } as React.ComponentProps<typeof SalesOrderHeaderForm>['formData'],
            isEditMode: false, updateOrderHeader: vi.fn(), formatPrice: String };
        const view = render(<SalesOrderHeaderForm {...props} />);
        expect(screen.queryByTestId('sales-order-contract-select')).toBeNull(); expect(screen.queryByText(/Sensitive contract/)).toBeNull();
        grants(); view.rerender(<SalesOrderHeaderForm {...props} />);
        expect(screen.getByTestId('sales-order-contract-select')).toBeTruthy();
    });
});

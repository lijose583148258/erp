// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const context = vi.hoisted(() => ({ actor: '8', permissions: ['orders.shippingReady.read', 'shipping.write'] as string[] | undefined }));
vi.mock('../../app/AppContext', () => ({ useAppContext: () => ({ currentUser: { id: context.actor, role: 'warehouse', permissions: context.permissions }, language: 'zh' }) }));
vi.mock('../../services/shipping.service', () => ({ shipmentService: { getDispatchTargets: vi.fn(), getAll: vi.fn() } }));
vi.mock('./ShipmentDraftDialog', () => ({ default: (props: { orderId: string; onCreated: (shipment: unknown, current: () => boolean, signal?: AbortSignal) => Promise<void> }) =>
  <button data-testid="test-dialog-read-created" onClick={() => { void props.onCreated({ id: '9', status: 'pending', frozen: true }, () => true, new AbortController().signal); }}>Read created {props.orderId}</button> }));
import { shipmentService } from '../../services/shipping.service';
import { prepareShipmentIntent } from '../../services/shipmentSubmissionIntent';
import ShippingReadyPanel from './ShippingReadyPanel';
const input = { customerId: '1', orderId: '2', orderItemId: '3', materialId: '4', productName: 'Resin', quantity: 40, unit: 'kg' };

describe('warehouse ready panel permission and recovery boundary', () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); context.actor = '8'; context.permissions = ['orders.shippingReady.read', 'shipping.write']; vi.mocked(shipmentService.getDispatchTargets).mockResolvedValue([]); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it('uses resolved shipping permissions without requiring orders.read', () => {
    render(<ShippingReadyPanel onRefresh={vi.fn()} onOpenShipment={vi.fn()} />);
    expect(screen.getByTestId('shipping-order-draft-open')).toBeTruthy();
    expect(context.permissions).not.toContain('orders.read');
  });
  it.each([{ permissions: [] }, { permissions: ['shipping.write'] }, { permissions: ['orders.shippingReady.read'] }])('resolved insufficient permissions $permissions do not fall back to role', ({ permissions }) => {
    context.permissions = permissions;
    render(<ShippingReadyPanel onRefresh={vi.fn()} onOpenShipment={vi.fn()} />);
    expect(screen.queryByTestId('shipping-order-draft-open')).toBeNull();
    expect(shipmentService.getDispatchTargets).not.toHaveBeenCalled();
  });
  it('discovers pending independently of candidates and shipment-list pagination', async () => {
    prepareShipmentIntent(localStorage, '8', 'order:2', input, () => 'pending-last-unit-request');
    prepareShipmentIntent(localStorage, '7', 'order:7', { ...input, orderId: '7' }, () => 'other-actor-request');
    render(<ShippingReadyPanel onRefresh={vi.fn()} onOpenShipment={vi.fn()} />);
    expect(await screen.findByTestId('shipping-order-recover-2')).toBeTruthy();
    expect(screen.queryByTestId('shipping-order-recover-7')).toBeNull();
    expect(shipmentService.getDispatchTargets).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('shipping-order-draft-open'));
    await waitFor(() => expect(shipmentService.getDispatchTargets).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('shipping-order-recover-2')).toBeTruthy();
    expect((shipmentService as unknown as { getAll: ReturnType<typeof vi.fn> }).getAll).not.toHaveBeenCalled();
  });
  it('draft success only triggers real candidate and workbench reads, never forwards frozen pending ACK as list data', async () => {
    prepareShipmentIntent(localStorage, '8', 'order:2', input, () => 'pending-refresh-request');
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<ShippingReadyPanel onRefresh={onRefresh} onOpenShipment={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('shipping-order-recover-2'));
    fireEvent.click(screen.getByTestId('test-dialog-read-created'));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(shipmentService.getDispatchTargets).toHaveBeenCalledExactlyOnceWith({ signal: expect.any(AbortSignal) });
    expect(onRefresh).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect((shipmentService as unknown as { getAll: ReturnType<typeof vi.fn> }).getAll).not.toHaveBeenCalled();
  });
  it('corrupt current-actor storage fails closed before candidate API and blocks order selection', async () => {
    localStorage.setItem('ailaoda.shipment-intent/v1.8.order%3A2', '{}');
    render(<ShippingReadyPanel onRefresh={vi.fn()} onOpenShipment={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('损坏');
    fireEvent.click(screen.getByTestId('shipping-order-draft-open'));
    await waitFor(() => expect(screen.getByTestId('shipping-order-draft-order').hasAttribute('disabled')).toBe(true));
    expect(shipmentService.getDispatchTargets).not.toHaveBeenCalled();
  });
});

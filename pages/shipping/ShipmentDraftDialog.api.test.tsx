// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHash, webcrypto } from 'node:crypto';
const context = vi.hoisted(() => ({ actor: '8' }));
vi.mock('../../app/AppContext', () => ({ useAppContext: () => ({ currentUser: { id: context.actor } }) }));
vi.mock('../../app/useDialogFocus', () => ({ useDialogFocus: vi.fn() }));
vi.mock('../../services/shipping.service', () => ({ shipmentService: { createSubmission: vi.fn(), findSubmission: vi.fn() } }));
import { shipmentService } from '../../services/shipping.service';
import { OrderStatus } from '../../types';
import { prepareShipmentIntent, readShipmentIntent, type ShipmentIntent, type ShipmentSubmissionResult } from '../../services/shipmentSubmissionIntent';
import type { ShipmentDispatchTarget } from '../../services/shipmentDispatchTarget';
import ShipmentDraftDialog from './ShipmentDraftDialog';

const target: ShipmentDispatchTarget = { id: '2', customerId: '1', orderNo: 'SO-2', status: OrderStatus.CONFIRMED,
  customer: { id: '1', name: 'Buyer' }, items: [{ id: 3, materialId: 4, productName: 'Resin', quantity: 40, unit: 'kg' }],
  fulfillment: { fullyDelivered: false, needsReview: false, lines: [{ orderItemId: 3, productName: 'Resin', orderedQuantity: 40, acceptedQuantity: 0, unallocatedQuantity: 40, unit: 'kg' }] } };
const input = { customerId: '1', orderId: '2', orderItemId: '3', materialId: '4', productName: 'Resin', quantity: 40, unit: 'kg' };
function ack(intent: ShipmentIntent): ShipmentSubmissionResult {
  const snapshot = { ...intent.facts, id: 9, shipmentNo: 'SHP-9', productBatchId: null, createdBy: Number(intent.userId), status: 'pending' as const, createdAt: '2026-10-15T00:00:00.000Z' };
  return { shipment: { ...snapshot, id: '9', customerId: '1', orderId: '2', orderItemId: '3', materialId: '4', productBatchId: undefined } as unknown as ShipmentSubmissionResult['shipment'],
    submission: { schema: 'shipment-submission/v1', key: intent.key, auditId: 10, actorId: Number(intent.userId), facts: intent.facts, shipment: snapshot,
      fingerprint: createHash('sha256').update(JSON.stringify({ actorId: Number(intent.userId), facts: intent.facts })).digest('hex') } };
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function open(onCreated = vi.fn().mockResolvedValue(undefined)) {
  const readTarget = vi.fn().mockResolvedValue(target), props = { orderId: '2', canWrite: true, onClose: vi.fn(), readTarget, onCreated };
  const view = render(<ShipmentDraftDialog {...props} />);
  await waitFor(() => expect(screen.getByTestId('shipping-order-shipment-line').hasAttribute('disabled')).toBe(false));
  fireEvent.change(screen.getByTestId('shipping-order-shipment-line'), { target: { value: '3' } });
  return { ...view, props, onCreated };
}
async function submit() { fireEvent.click(screen.getByTestId('shipping-order-shipment-create')); await waitFor(() => expect(shipmentService.createSubmission).toHaveBeenCalledTimes(1)); }

describe('shared native shipment draft dialog', () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); context.actor = '8'; vi.stubGlobal('crypto', webcrypto);
    vi.mocked(shipmentService.createSubmission).mockImplementation(async () => ack(readShipmentIntent(localStorage, '8', 'order:2')!)); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('creates with real line identity and optional blank batch, then reads current data only', async () => {
    const { onCreated } = await open(); await submit();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(shipmentService.createSubmission).toHaveBeenCalledWith(expect.objectContaining(input), expect.any(String));
    expect(readShipmentIntent(localStorage, '8', 'order:2')).toBeNull();
    expect(screen.getByTestId('shipping-order-shipment-create').hasAttribute('disabled')).toBe(true);
    expect(onCreated.mock.calls[0][1]()).toBe(true);
  });

  it.each(['unmount', 'actor switch'] as const)('%s while ACK fingerprint is pending preserves both actors and never calls old onCreated', async mode => {
    const digest = deferred<ArrayBuffer>(), spy = vi.fn(() => digest.promise);
    vi.stubGlobal('crypto', { randomUUID: () => 'original-async-request', subtle: { digest: spy } });
    const view = await open(); await submit(); await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const original = readShipmentIntent(localStorage, '8', 'order:2')!;
    const other = prepareShipmentIntent(localStorage, '7', 'order:2', input, () => 'other-actor-request');
    if (mode === 'unmount') view.unmount(); else { context.actor = '7'; view.rerender(<ShipmentDraftDialog {...view.props} />); }
    await act(async () => { digest.resolve(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ actorId: 8, facts: original.facts })))); });
    expect(readShipmentIntent(localStorage, '8', 'order:2')).toEqual(original);
    expect(readShipmentIntent(localStorage, '7', 'order:2')).toEqual(other);
    expect(view.onCreated).not.toHaveBeenCalled();
  });

  it('proved ACK plus failed cleanup locks creation and retry only cleans and reads', async () => {
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => { throw Error('storage locked'); });
    const { onCreated } = await open(); await submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('storage locked'));
    expect(screen.getByTestId('shipping-order-shipment-success')).toBeTruthy();
    expect(screen.getByTestId('shipping-order-shipment-create').hasAttribute('disabled')).toBe(true);
    expect(onCreated).not.toHaveBeenCalled(); remove.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '只重试读取' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(shipmentService.createSubmission).toHaveBeenCalledTimes(1);
    expect(readShipmentIntent(localStorage, '8', 'order:2')).toBeNull();
  });

  it('proved ACK plus failed real readback cannot POST again and can only retry reading', async () => {
    const onCreated = vi.fn().mockRejectedValueOnce(Error('readback unavailable')).mockResolvedValueOnce(undefined);
    await open(onCreated); await submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('readback unavailable'));
    fireEvent.click(screen.getByTestId('shipping-order-shipment-create'));
    fireEvent.click(screen.getByRole('button', { name: '只重试读取' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));
    expect(shipmentService.createSubmission).toHaveBeenCalledTimes(1);
  });

  it('reopens an allocated-last-unit original even with no candidate and recovers same identity', async () => {
    const original = prepareShipmentIntent(localStorage, '8', 'order:2', input, () => 'already-allocated-request');
    vi.mocked(shipmentService.findSubmission).mockResolvedValue(ack(original));
    const onCreated = vi.fn().mockResolvedValue(undefined);
    render(<ShipmentDraftDialog orderId="2" canWrite readTarget={vi.fn().mockResolvedValue(null)} onCreated={onCreated} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('shipping-order-shipment-recover'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(shipmentService.findSubmission).toHaveBeenCalledExactlyOnceWith(original.key);
    expect(shipmentService.createSubmission).not.toHaveBeenCalled();
  });
});

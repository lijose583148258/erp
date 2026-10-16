// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createHash, webcrypto } from 'node:crypto';
const context = vi.hoisted(() => ({ actor: '8' }));
vi.mock('../app/AppContext', () => ({ useAppContext: () => ({ currentUser: { id: context.actor }, registerUnsavedChanges: () => {}, confirmDiscardChanges: () => true }) }));
vi.mock('../utils/clientIssue', () => ({ reportClientIssue: vi.fn() }));
vi.mock('./shipping.service', () => ({ shipmentService: { getReceiptEvents: vi.fn(), findReceiptSubmission: vi.fn(), createReceiptEvent: vi.fn() } }));
import { shipmentService, type ShipmentReceiptBundle } from './shipping.service';
import { prepareReceiptIntent, readReceiptIntent, receiptIntentFacts, type ReceiptIntent } from './shipmentReceiptIntent';
import { useShippingReceipts } from '../pages/shipping/useShippingReceipts';

const shipment = { id: '9', quantity: 30, unit: 'kg', status: 'in_transit' as const, productName: 'Resin' } as ShipmentReceiptBundle['shipment'];
const bundle = (remaining: number): ShipmentReceiptBundle => ({ shipment, receiptSummary: { shipmentQuantity: 30, processedQuantity: 30 - remaining,
  acceptedQuantity: 30 - remaining, rejectedQuantity: 0, remainingQuantity: remaining, receiptCount: remaining === 30 ? 0 : 1 }, receipts: [], discrepancyCases: [] });
const rejection = (intent: ReceiptIntent) => ({ status: 409, errorCode: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', details: { rejectedSubmission: {
  schema: 'shipment-receipt-rejection/v1', key: intent.key, actorId: Number(intent.actorId), shipmentId: Number(intent.shipmentId), auditId: 99,
  code: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', fingerprint: createHash('sha256').update(JSON.stringify({ shipmentId: Number(intent.shipmentId), actorId: Number(intent.actorId), facts: intent.facts })).digest('hex') } } });
const prepare = async () => prepareReceiptIntent(localStorage, '8', '9', await receiptIntentFacts({ quantity: 30, acceptedQuantity: 30, rejectedQuantity: 0 }), () => 'original-thirty-receipt');
const render = () => renderHook(() => useShippingReceipts({ t: {}, notify: vi.fn(), setShipments: vi.fn(), canWrite: true }));

describe('native durable receipt rejection recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); context.actor = '8'; vi.stubGlobal('crypto', webcrypto); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('POST refusal clears only proved intent, reads latest remaining 10 and unlocks correction without another POST', async () => {
    vi.mocked(shipmentService.getReceiptEvents).mockResolvedValueOnce(bundle(30)).mockResolvedValueOnce(bundle(10));
    vi.mocked(shipmentService.createReceiptEvent).mockImplementation(async () => { throw rejection(readReceiptIntent(localStorage, '8', '9')!); });
    const { result } = render();
    await act(async () => result.current.handleOpenReceiptEvents(shipment));
    await act(async () => result.current.handleSubmitReceiptEvent());
    expect(shipmentService.createReceiptEvent).toHaveBeenCalledTimes(1); expect(shipmentService.getReceiptEvents).toHaveBeenCalledTimes(2);
    expect(readReceiptIntent(localStorage, '8', '9')).toBeNull(); expect(result.current.receiptPending).toBeNull();
    expect(result.current.receiptFieldsLocked).toBe(false); expect(result.current.receiptForm.quantity).toBe('10');
    expect(result.current.receiptError).toContain('不会自动重提');
  });
  it('reopened rejected identity uses GET proof to refresh and unlock without POST', async () => {
    const intent = await prepare();
    vi.mocked(shipmentService.findReceiptSubmission).mockRejectedValueOnce(rejection(intent));
    vi.mocked(shipmentService.getReceiptEvents).mockResolvedValueOnce(bundle(10));
    const { result } = render(); await act(async () => result.current.handleOpenReceiptEvents(shipment));
    expect(shipmentService.findReceiptSubmission).toHaveBeenCalledExactlyOnceWith('9', intent.key);
    expect(shipmentService.createReceiptEvent).not.toHaveBeenCalled(); expect(readReceiptIntent(localStorage, '8', '9')).toBeNull();
    expect(result.current.receiptForm.quantity).toBe('10'); expect(result.current.receiptFieldsLocked).toBe(false);
  });
  it('generic POST 409 leaves original 30 frozen and does not refresh it as a new request', async () => {
    vi.mocked(shipmentService.getReceiptEvents).mockResolvedValueOnce(bundle(30));
    vi.mocked(shipmentService.createReceiptEvent).mockRejectedValueOnce({ status: 409, errorCode: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING' });
    const { result } = render(); await act(async () => result.current.handleOpenReceiptEvents(shipment));
    await act(async () => result.current.handleSubmitReceiptEvent());
    expect(result.current.receiptPending?.facts.quantity).toBe(30); expect(result.current.receiptFieldsLocked).toBe(true);
    expect(readReceiptIntent(localStorage, '8', '9')?.key).toBe(result.current.receiptPending?.key);
    expect(shipmentService.getReceiptEvents).toHaveBeenCalledTimes(1); expect(shipmentService.createReceiptEvent).toHaveBeenCalledTimes(1);
  });
  it('bad reopened GET proof keeps original identity and never POSTs or trusts a fresh bundle', async () => {
    const intent = await prepare(), error = rejection(intent); error.details.rejectedSubmission.fingerprint = 'a'.repeat(64);
    vi.mocked(shipmentService.findReceiptSubmission).mockRejectedValueOnce(error);
    const { result } = render(); await act(async () => result.current.handleOpenReceiptEvents(shipment));
    expect(readReceiptIntent(localStorage, '8', '9')).toEqual(intent); expect(result.current.receiptPending).toEqual(intent);
    expect(result.current.receiptFieldsLocked).toBe(true); expect(shipmentService.getReceiptEvents).not.toHaveBeenCalled();
    expect(shipmentService.createReceiptEvent).not.toHaveBeenCalled();
  });
  it('actor switched during GET cannot clear prior actor intent or fill the next actor drawer', async () => {
    const intent = await prepare(); let reject!: (error: unknown) => void;
    vi.mocked(shipmentService.findReceiptSubmission).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { result, rerender } = render(); let opening!: Promise<void>;
    act(() => { opening = result.current.handleOpenReceiptEvents(shipment); });
    context.actor = '7'; rerender();
    await act(async () => { reject(rejection(intent)); await opening; });
    expect(readReceiptIntent(localStorage, '8', '9')).toEqual(intent); expect(result.current.receiptDrawerShipment).toBeNull();
    expect(result.current.receiptBundle).toBeNull(); expect(shipmentService.createReceiptEvent).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/api', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
import api from '../utils/api';
import { shipmentService } from './shipping.service';

describe('native receipt FileReader boundary', () => {
  let finishRead: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockResolvedValue({ data: { shipment: { id: 9, quantity: 30 }, receipts: [] } });
    vi.stubGlobal('FileReader', class {
      result = 'data:image/png;base64,AQID';
      onload: (() => void) | null = null;
      readAsDataURL() { finishRead = () => this.onload?.(); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const input = () => ({ quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, file: new File(['proof'], 'proof.png', { type: 'image/png' }) });
  it('actor or shipment changed during async file read sends no POST', async () => {
    let current = true;
    const pending = shipmentService.createReceiptEvent('9', input(), 'original-receipt-request', () => current);
    expect(api.post).not.toHaveBeenCalled();
    current = false; finishRead();
    await expect(pending).rejects.toThrow('操作人或发货单已变化');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('unchanged native owner sends the original identity and exact payload only after read', async () => {
    const pending = shipmentService.createReceiptEvent('9', input(), 'original-receipt-request', () => true);
    expect(api.post).not.toHaveBeenCalled(); finishRead(); await pending;
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/shipping/9/receipt-events', {
      quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, discrepancyType: undefined, discrepancyReason: undefined, note: undefined,
      fileName: 'proof.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID',
    }, { headers: { 'Idempotency-Key': 'original-receipt-request' } });
  });
  it('legacy direct integrations keep the two-argument unkeyed API contract', async () => {
    await shipmentService.createReceiptEvent('9', { quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/shipping/9/receipt-events', {
      quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, discrepancyType: undefined, discrepancyReason: undefined, note: undefined,
    }, undefined);
  });
});

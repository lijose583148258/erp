jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn(), auditLog: { create: jest.fn() } } }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: jest.fn(action => action()) }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../services/shipment-material-identity', () => ({ resolveShipmentIdentity: jest.fn() }));
jest.mock('./shipping-controller.helpers', () => ({ canManageShipping: jest.fn(), getShipmentDetail: jest.fn() }));
import prisma from '../config/database';
import { resolveShipmentIdentity } from '../services/shipment-material-identity';
import { canManageShipping, getShipmentDetail } from './shipping-controller.helpers';
import { ShippingController } from './shipping.controller';

function fixture() {
    jest.clearAllMocks();
    const created = { id: 9, shipmentNo: 'SHP-9', status: 'pending' };
    const tx = { shipment: { create: jest.fn().mockResolvedValue(created) }, auditLog: { create: jest.fn().mockResolvedValue({ id: 10 }) } };
    (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
    (resolveShipmentIdentity as jest.Mock).mockResolvedValue({ orderId: 2, orderItemId: 3, materialId: 4, productName: 'Resin', unit: 'kg', batchNo: 'LOT-1' });
    (canManageShipping as jest.Mock).mockReturnValue(true);
    (getShipmentDetail as jest.Mock).mockResolvedValue(created);
    const req: any = { user: { userId: 8 }, body: { customerId: 1, orderId: 2, orderItemId: 3, quantity: 40, unit: 'kg' }, ip: '127.0.0.1', get: jest.fn(name => name === 'user-agent' ? 'test-client' : undefined) };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    return { created, tx, req, res, controller: new ShippingController() };
}

test('shipment and its creation audit use the same serializable transaction', async () => {
    const f = fixture(); await f.controller.createShipment(f.req, f.res);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(resolveShipmentIdentity).toHaveBeenCalledWith(f.tx, expect.objectContaining({ orderId: 2, quantity: 40 }));
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ resource: 'shipment', resourceId: 9, action: 'CREATE', userId: 8 }) });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(f.res.status).toHaveBeenCalledWith(201);
    expect(f.res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: f.created }));
});

test('audit failure rejects the transaction before readback or success response', async () => {
    const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await f.controller.createShipment(f.req, f.res);
    expect(f.tx.shipment.create).toHaveBeenCalledTimes(1);
    const transaction = (prisma.$transaction as jest.Mock).mock.results[0].value;
    await expect(transaction).rejects.toThrow('audit unavailable');
    expect(prisma.auditLog.create).not.toHaveBeenCalled(); expect(getShipmentDetail).not.toHaveBeenCalled();
    expect(f.res.status).toHaveBeenCalledWith(500);
    expect(f.res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
});

test('invalid identity creates neither a shipment nor an audit', async () => {
    const f = fixture(); (resolveShipmentIdentity as jest.Mock).mockRejectedValue(new Error('SHIPMENT_ORDER_ITEM_QUANTITY_EXCEEDED'));
    await f.controller.createShipment(f.req, f.res);
    expect(f.tx.shipment.create).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.res.status).toHaveBeenCalledWith(409);
});

test('denied actors never begin a write transaction', async () => {
    const f = fixture(); (canManageShipping as jest.Mock).mockReturnValue(false);
    await f.controller.createShipment(f.req, f.res);
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(f.res.status).toHaveBeenCalledWith(403);
});

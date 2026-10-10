import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// Route wiring contract only. Database transitions are tested by real probes.
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
  authorizePermission: (...requiredPermissions: string[]) => (req: Request, res: Response, next: NextFunction) => {
    const granted = String(req.headers['x-test-permissions'] || '').split(',');
    return requiredPermissions.every(p => granted.includes(p)) ? next() : res.status(403).json({ requiredPermissions });
  },
}));
jest.mock('../controllers/procurement.controller', () => {
  const handler = (_req: Request, res: Response) => res.status(200).json({ reachedController: true });
  return { ProcurementController: class {
    getSuppliers = handler; createSupplier = handler; getOrders = handler; createOrder = handler; reviseOrder = handler;
    getOrderRevisions = handler; updateOrderStatus = handler; getOrderReceipts = handler; createReceipt = handler;
    linkB2BOrder = handler; getB2BStatus = handler; syncB2BStatus = handler;
  } };
});
import router from './procurement.routes';
const app = express(); app.use(express.json(), router);
const payload = { supplierId: 1, materialId: 1, item: 'Owned fixture', unit: 'kg', quantity: 10, price: 10, eta: '2026-10-06' };
test.each(['approved', 'confirmed', 'in_transit', 'shipped'])('creating %s cannot bypass approval', async status => {
  expect((await request(app).post('/orders').set('x-test-permissions', 'procurement.write').send({ ...payload, status })).status).toBe(403);
  expect((await request(app).post('/orders').set('x-test-permissions', 'procurement.write,procurement.approve').send({ ...payload, status })).status).toBe(200);
});
test.each([
  ['approved', 'procurement.approve'], ['confirmed', 'procurement.approve'],
  ['received', 'procurement.receive'], ['delivered', 'procurement.receive'],
  ['in_transit', 'procurement.write'], ['shipped', 'procurement.write'], ['pending', 'procurement.write'], ['cancelled', 'procurement.write'],
])('status %s uses exact responsibility %s', async (status, permission) => {
  for (const granted of ['procurement.write', 'procurement.approve', 'procurement.receive']) {
    const result = await request(app).patch('/orders/1/status').set('x-test-permissions', granted).send({ status });
    expect(result.status).toBe(granted === permission ? 200 : 403);
    if (result.status === 403) expect(result.body.requiredPermissions).toEqual([permission]);
  }
});
test('receipt creation does not inherit buyer or approver rights', async () => {
  for (const granted of ['procurement.write', 'procurement.approve', 'procurement.receive']) {
    expect((await request(app).post('/orders/1/receipts').set('x-test-permissions', granted).send({ quantity: 1 })).status).toBe(granted === 'procurement.receive' ? 200 : 403);
  }
});
test('B2B shortcut requires every responsibility it can cross', async () => {
  const all = ['procurement.write', 'procurement.approve', 'procurement.receive'];
  for (const missing of all) expect((await request(app).post('/sync-b2b/1').set('x-test-permissions', all.filter(p => p !== missing).join(',')).send({ salesStatus: 'delivered' })).status).toBe(403);
  expect((await request(app).post('/sync-b2b/1').set('x-test-permissions', all.join(',')).send({ salesStatus: 'delivered' })).status).toBe(200);
});
test('buyer retains draft creation, but invalid status cannot reach the controller', async () => {
  expect((await request(app).post('/orders').set('x-test-permissions', 'procurement.write').send(payload)).status).toBe(200);
  expect((await request(app).patch('/orders/1/status').set('x-test-permissions', 'procurement.write').send({ status: 'fake' })).status).toBe(400);
});

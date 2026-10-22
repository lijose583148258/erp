import { EventEmitter } from 'events';
import type { Server } from 'http';
import type { RealtimeNotificationEvent } from './realtime-notification.service';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  user: { findUnique: jest.fn() }, paymentRecord: { findFirst: jest.fn() },
} }));
jest.mock('../utils/jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('./auth-token-store.service', () => ({ isTokenBlacklisted: jest.fn() }));
jest.mock('./authorization-policy.service', () => ({
  roleExistsAndActive: jest.fn(), getPermissionsForRole: jest.fn(), getDataScopesForRole: jest.fn(),
}));
jest.mock('./role-assignment-policy.service', () => ({
  resolveUserSegment: (_role: string, segment: string) => segment || 'mixed',
}));
jest.mock('../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('../infrastructure/redis-runtime', () => ({
  isRedisConfigured: jest.fn(() => false), createRedisClient: jest.fn(),
  ensureRedisConnected: jest.fn().mockResolvedValue(undefined),
}));

type Policy = { permissions: string[]; scopes: string[]; active: boolean };
const tick = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const oldDriver = process.env.REALTIME_BUS_DRIVER;
let service: typeof import('./realtime-notification.service');
let db: { user: { findUnique: jest.Mock }; paymentRecord: { findFirst: jest.Mock } };
let policies: Map<string, Policy>, users: Map<number, any>, claims: Map<string, any>;
let tokenStore: { isTokenBlacklisted: jest.Mock }, jwt: { verifyToken: jest.Mock };
let server: EventEmitter, subscriber: EventEmitter & { subscribe: jest.Mock; status: string };
let publisher: { publish: jest.Mock; status: string };
let policyService: { roleExistsAndActive: jest.Mock; getPermissionsForRole: jest.Mock; getDataScopesForRole: jest.Mock };

async function load(driver = 'memory') {
  jest.resetModules(); process.env.REALTIME_BUS_DRIVER = driver;
  db = require('../config/database').default;
  tokenStore = require('./auth-token-store.service'); jwt = require('../utils/jwt');
  policyService = require('./authorization-policy.service');
  users = new Map(); policies = new Map(); claims = new Map();
  tokenStore.isTokenBlacklisted.mockResolvedValue(false);
  jwt.verifyToken.mockImplementation(token => {
    if (!claims.has(token)) throw new Error('Invalid fixture token');
    return claims.get(token);
  });
  db.user.findUnique.mockImplementation(({ where }) => Promise.resolve(users.get(where.id) || null));
  db.paymentRecord.findFirst.mockResolvedValue({ id: 7 });
  policyService.roleExistsAndActive.mockImplementation(role => Promise.resolve(policies.get(role)?.active === true));
  policyService.getPermissionsForRole.mockImplementation(role => Promise.resolve(policies.get(role)?.permissions || []));
  policyService.getDataScopesForRole.mockImplementation(role => Promise.resolve(policies.get(role)?.scopes || []));
  subscriber = Object.assign(new EventEmitter(), { subscribe: jest.fn().mockResolvedValue(undefined), status: 'ready' });
  publisher = { publish: jest.fn().mockResolvedValue(1), status: 'ready' };
  require('../infrastructure/redis-runtime').createRedisClient.mockImplementation((name: string) => name.endsWith('publisher') ? publisher : subscriber);
  service = require('./realtime-notification.service');
  server = new EventEmitter(); service.attachRealtimeNotifications(server as Server); await tick();
}

async function connect(id: number, role: string, scopes = ['finance_visible']) {
  const token = `private-fixture-token-${id}`;
  claims.set(token, { userId: id, username: `fixture${id}`, role, segment: 'mixed', authAt: 2000 });
  users.set(id, { id, username: `fixture${id}`, role, segment: 'mixed', isActive: true,
    updatedAt: new Date(1000), mustChangePassword: false });
  if (!policies.has(role)) policies.set(role, { permissions: ['collections.read'], scopes, active: true });
  const socket = Object.assign(new EventEmitter(), { write: jest.fn(), end: jest.fn(), destroy: jest.fn() });
  server.emit('upgrade', { url: `/ws/notifications?token=${token}`, headers: { host: '127.0.0.1', 'sec-websocket-key': 'fixture-key' } }, socket);
  await tick(); expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('101 Switching Protocols'));
  socket.write.mockClear(); return { socket, token };
}

function frames(socket: { write: jest.Mock }) {
  return socket.write.mock.calls.map(([value]) => value).filter(value => Buffer.isBuffer(value) && value[0] === 0x81).map((buffer: Buffer) => {
    const head = buffer[1] < 126 ? 2 : buffer[1] === 126 ? 4 : 10;
    return JSON.parse(buffer.subarray(head).toString('utf8'));
  });
}

function payment(overrides: Record<string, unknown> = {}): RealtimeNotificationEvent & { id: string } {
  return { id: 'stable-payment-event', occurredAt: '2026-10-02T00:00:00.000Z', type: 'payment.verified',
    title: 'Payment verified', message: 'Order payment verified', resourceType: 'payment', resourceId: 7,
    audience: { roles: ['admin', 'manager', 'finance'], paymentReadAccess: 'current-policy-v1' } as any, ...overrides };
}

afterEach(() => {
  jest.useRealTimers();
  if (oldDriver === undefined) delete process.env.REALTIME_BUS_DRIVER; else process.env.REALTIME_BUS_DRIVER = oldDriver;
});

it('retains the synchronous ordinary-notification return value and legacy role/user-ID intersection', async () => {
  await load(); const finance = await connect(1, 'finance'), sales = await connect(2, 'sales');
  const ordinary = { ...payment(), type: 'order.updated', resourceType: 'order', audience: { roles: ['finance'], userIds: [1] } } as RealtimeNotificationEvent;
  expect(service.publishRealtimeNotification(ordinary)).toBe(1);
  expect(frames(finance.socket)).toHaveLength(1); expect(frames(sales.socket)).toEqual([]);
  expect(db.user.findUnique).not.toHaveBeenCalled();
});

it('delivers a durable payment hint to a current least-privilege custom finance role rather than its name', async () => {
  await load(); const finance = await connect(7, 'r2wf_receivables');
  await service.publishDurableRealtimeNotification(payment()); await tick();
  expect(frames(finance.socket)).toEqual([payment()]);
  expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  expect(db.paymentRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
  expect(JSON.stringify(frames(finance.socket))).not.toContain(finance.token);
});

it.each(['payment.verified', 'payment.reversed'] as const)('checks current policy again after connection and before each %s event', async type => {
  await load(); const finance = await connect(7, 'custom_ar');
  await service.publishDurableRealtimeNotification(payment({ type }));
  expect(frames(finance.socket)).toHaveLength(1);
  policies.get('custom_ar')!.permissions = [];
  await service.publishDurableRealtimeNotification(payment({ type, id: 'after-revocation' }));
  expect(frames(finance.socket)).toHaveLength(1);
  expect(policyService.getPermissionsForRole).toHaveBeenCalledTimes(2);
});

it.each(['inactive-user', 'inactive-role', 'must-change-password', 'newer-account', 'blacklisted', 'expired-token', 'missing-user', 'missing-grant'])(
  'does not send to an already connected %s identity', async condition => {
    await load(); const finance = await connect(7, 'custom_ar');
    if (condition === 'inactive-user') users.get(7).isActive = false;
    if (condition === 'inactive-role') policies.get('custom_ar')!.active = false;
    if (condition === 'must-change-password') users.get(7).mustChangePassword = true;
    if (condition === 'newer-account') users.get(7).updatedAt = new Date(3000);
    if (condition === 'blacklisted') tokenStore.isTokenBlacklisted.mockResolvedValue(true);
    if (condition === 'expired-token') claims.delete(finance.token);
    if (condition === 'missing-user') users.delete(7);
    if (condition === 'missing-grant') policies.get('custom_ar')!.permissions = ['finance.read'];
    await service.publishDurableRealtimeNotification(payment());
    expect(frames(finance.socket)).toEqual([]);
  },
);

it('uses the same own-customer payment predicate as the collection ledger, including later ownership changes', async () => {
  await load(); const a = await connect(1, 'own_a', ['own_customers']), b = await connect(2, 'own_b', ['own_customers']);
  let salespersonId = 1;
  db.paymentRecord.findFirst.mockImplementation(({ where }) => {
    const viewer = where.AND[1].order.OR[0].createdBy;
    expect(where).toEqual({ AND: [{ id: 7 }, { order: { OR: [
      { createdBy: viewer }, { customer: { poolState: 'private', salespersonId: viewer } },
    ] } }] });
    return Promise.resolve(viewer === salespersonId ? { id: 7 } : null);
  });
  await service.publishDurableRealtimeNotification(payment());
  expect(frames(a.socket)).toHaveLength(1); expect(frames(b.socket)).toHaveLength(0);
  salespersonId = 2;
  await service.publishDurableRealtimeNotification(payment({ id: 'after-customer-transfer' }));
  expect(frames(a.socket)).toHaveLength(1); expect(frames(b.socket)).toHaveLength(1);
});

it('does not turn a revoked scope or a nonexistent payment into a readable record', async () => {
  await load(); const finance = await connect(7, 'custom_ar');
  policies.get('custom_ar')!.scopes = [];
  db.paymentRecord.findFirst.mockImplementation(({ where }) => {
    expect(where).toEqual({ AND: [{ id: 7 }, { order: { id: -1 } }] });
    return Promise.resolve(null);
  });
  await service.publishDurableRealtimeNotification(payment());
  expect(frames(finance.socket)).toEqual([]);
  policies.get('custom_ar')!.scopes = ['finance_visible'];
  db.paymentRecord.findFirst.mockResolvedValue(null);
  await service.publishDurableRealtimeNotification(payment({ id: 'missing-record' }));
  expect(frames(finance.socket)).toEqual([]);
});

it.each(['database', 'token-store', 'policy'])('fails closed on %s outage without logging private tokens', async dependency => {
  await load(); const finance = await connect(7, 'finance');
  const failure = new Error(`private backend error ${finance.token}`);
  if (dependency === 'database') db.user.findUnique.mockRejectedValue(failure);
  if (dependency === 'token-store') tokenStore.isTokenBlacklisted.mockRejectedValue(failure);
  if (dependency === 'policy') policyService.getPermissionsForRole.mockRejectedValue(failure);
  await expect(service.publishDurableRealtimeNotification(payment())).rejects.toThrow('Payment realtime authorization unavailable');
  expect(frames(finance.socket)).toEqual([]);
  expect(JSON.stringify(require('../utils/logger').logger.warn.mock.calls)).not.toContain(finance.token);
});

it.each([
  { audience: { paymentReadAccess: false } }, { audience: { paymentReadAccess: 'unknown' } },
  { resourceType: 'order' }, { resourceId: '7' }, { resourceId: -1 }, { resourceId: 0 },
  { type: 'payment.submitted' }, { id: '' },
  { audience: { paymentReadAccess: 'current-policy-v1', userIds: [0] } },
])('rejects malformed dedicated scope instead of falling back to legacy roles: %p', async patch => {
  await load(); const finance = await connect(7, 'finance');
  await expect(service.publishDurableRealtimeNotification(payment(patch))).rejects.toThrow(/Invalid payment realtime/);
  expect(frames(finance.socket)).toEqual([]); expect(db.user.findUnique).not.toHaveBeenCalled();
  expect(publisher.publish).not.toHaveBeenCalled();
});

it('treats an explicit empty dedicated recipient restriction as nobody, not everybody', async () => {
  await load(); const finance = await connect(7, 'finance');
  await service.publishDurableRealtimeNotification(payment({ audience: { roles: ['finance'], paymentReadAccess: 'current-policy-v1', userIds: [] } }));
  expect(frames(finance.socket)).toEqual([]); expect(db.user.findUnique).not.toHaveBeenCalled();
  expect(service.publishRealtimeNotification(payment())).toBe(0);
  expect(frames(finance.socket)).toEqual([]);
});

it('applies the identical current-policy guard to the other node Redis path', async () => {
  await load('redis'); const finance = await connect(7, 'dynamic_ar');
  const deliver = (event: unknown) => subscriber.emit('message', 'ailaoda:realtime:notifications', JSON.stringify({ origin: 'other-instance', event }));
  deliver(payment()); await tick();
  expect(frames(finance.socket)).toEqual([payment()]);
  policies.get('dynamic_ar')!.permissions = [];
  deliver(payment({ id: 'after-other-node-revocation' })); await tick();
  expect(frames(finance.socket)).toHaveLength(1);
  deliver(payment({ audience: { roles: ['dynamic_ar'], paymentReadAccess: 'invalid' } })); await tick();
  expect(frames(finance.socket)).toHaveLength(1);
});

it('bounds authorization waits, leaves durable failure visible, and never sends late results', async () => {
  await load(); const finance = await connect(7, 'dynamic_ar');
  jest.useFakeTimers(); let finish: (value: unknown) => void = () => {};
  db.user.findUnique.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const delivered = service.publishDurableRealtimeNotification(payment());
  const rejected = expect(delivered).rejects.toThrow('Payment realtime authorization unavailable');
  await jest.advanceTimersByTimeAsync(3000); await rejected;
  finish(users.get(7)); await tick();
  expect(frames(finance.socket)).toEqual([]);
});

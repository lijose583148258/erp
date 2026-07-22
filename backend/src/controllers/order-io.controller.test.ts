import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { writeOrderAuditLog } from '../services/order-audit.service';
import { normalizeOrderImportIdempotencyKey } from '../services/order-import-idempotency.service';
import { orderImportService } from '../services/order-import.service';
import { OrderWorkspaceService } from '../services/order-workspace.service';
import { exportOrders, importOrders } from './order-io.controller';

jest.mock('../services/order-audit.service', () => ({ writeOrderAuditLog: jest.fn() }));
jest.mock('../services/order-import-idempotency.service', () => ({ normalizeOrderImportIdempotencyKey: jest.fn() }));
jest.mock('../services/order-import.service', () => ({ orderImportService: { importOrders: jest.fn() } }));
jest.mock('../services/order-workspace.service', () => ({ OrderWorkspaceService: { exportOrders: jest.fn() } }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

function responseHarness() {
    const res = {
        status: jest.fn(),
        json: jest.fn(),
        setHeader: jest.fn(),
        end: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res as unknown as Response;
}

function requestHarness(overrides: Partial<AuthRequest> = {}) {
    return {
        body: { orders: [{ orderNo: 'ORD-1' }] },
        query: {},
        get: jest.fn(),
        user: { userId: 7, username: 'tester', role: 'admin' },
        ...overrides,
    } as unknown as AuthRequest;
}

const normalizeKeyMock = normalizeOrderImportIdempotencyKey as jest.MockedFunction<typeof normalizeOrderImportIdempotencyKey>;
const importMock = orderImportService.importOrders as jest.MockedFunction<typeof orderImportService.importOrders>;
const exportMock = OrderWorkspaceService.exportOrders as jest.MockedFunction<typeof OrderWorkspaceService.exportOrders>;
const auditMock = writeOrderAuditLog as jest.MockedFunction<typeof writeOrderAuditLog>;

beforeEach(() => {
    jest.clearAllMocks();
});

test('order import rejects a missing normalized idempotency key before service execution', async () => {
    normalizeKeyMock.mockReturnValue(null);
    const req = requestHarness();
    const res = responseHarness();

    await importOrders(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(importMock).not.toHaveBeenCalled();
});

test('order import preserves governed service errors and status codes', async () => {
    normalizeKeyMock.mockReturnValue('idem-test-123');
    importMock.mockResolvedValue({ error: 'Import batch is still processing.', statusCode: 409 });
    const req = requestHarness();
    const res = responseHarness();

    await importOrders(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Import batch is still processing.' });
});

test('order import reports replayed results without changing their counts', async () => {
    normalizeKeyMock.mockReturnValue('idem-test-456');
    const result = { success: 3, failed: 1, errors: [] };
    importMock.mockResolvedValue({ result, replayed: true });
    const req = requestHarness();
    const res = responseHarness();

    await importOrders(req, res);

    expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: result,
        message: '幂等重放：成功 3 条，失败 1 条',
    });
});

test('order export writes headers and audit evidence before streaming the workbook', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    exportMock.mockResolvedValue({ workbook: { xlsx: { write } }, orders: [{ id: 1 }, { id: 2 }] } as never);
    auditMock.mockResolvedValue(undefined);
    const req = requestHarness({ query: { status: 'confirmed', lang: 'zh-CN' } as never });
    const res = responseHarness();

    await exportOrders(req, res);

    expect(exportMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', lang: 'zh-CN' }), req);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(auditMock).toHaveBeenCalledWith(req, { action: 'EXPORT', details: '导出订单: 2 条' });
    expect(write).toHaveBeenCalledWith(res);
    expect(res.end).toHaveBeenCalled();
    expect(auditMock.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
});

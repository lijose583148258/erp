jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
import prisma from '../config/database';
import { MaterialMasterService } from './material-master.service';

const relations = ['densityRevisions', 'packagingRevisions', 'bomItems', 'productionBoms', 'productionWorkOrders', 'salesOrderItems', 'purchaseOrders', 'shipments', 'productBatches', 'stockBalances', 'stockMovements', 'genealogyInputs', 'genealogyOutputs', 'barterAgreementItems', 'barterItems'];
const emptyCounts = () => Object.fromEntries(relations.map(key => [key, 0]));
const audit = { userId: 1 };
function fixture(patch: Record<string, unknown> = {}) {
  const current = { id: 17, code: 'UNIT-TEST', baseUnit: 'kg', status: 'draft', isTemporary: true, updatedAt: new Date('2026-01-01T00:00:00Z'), _count: emptyCounts(), ...patch };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(1), material: { findUnique: jest.fn().mockImplementation(async () => current), update: jest.fn(), updateMany: jest.fn().mockImplementation(async ({ data }) => { Object.assign(current, data); return { count: 1 }; }) }, auditLog: { create: jest.fn().mockResolvedValue({}) } };
  (prisma.$transaction as jest.Mock).mockImplementation(async callback => callback(tx)); return { current, tx };
}
describe('material base-unit governance', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each(['active', 'blocked'])('freezes %s units before writes or audit', async status => {
    const { tx } = fixture({ status, isTemporary: false });
    await expect(MaterialMasterService.update(17, { baseUnit: 't' }, audit)).rejects.toThrow('MATERIAL_BASE_UNIT_FROZEN');
    expect(tx.material.updateMany).not.toHaveBeenCalled(); expect(tx.material.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(relations)('freezes a legacy draft referenced by %s', async relation => {
    const { tx } = fixture({ _count: { ...emptyCounts(), [relation]: 1 } });
    await expect(MaterialMasterService.update(17, { baseUnit: 'g', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }, audit)).rejects.toThrow('MATERIAL_BASE_UNIT_FROZEN');
    expect(tx.material.updateMany).not.toHaveBeenCalled();
  });
  it('fails closed if reference counts are unavailable', async () => {
    fixture({ _count: undefined });
    await expect(MaterialMasterService.update(17, { baseUnit: 'g', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }, audit)).rejects.toThrow('MATERIAL_BASE_UNIT_FROZEN');
  });
  it('requires a read version for unused draft unit corrections', async () => {
    fixture(); await expect(MaterialMasterService.update(17, { baseUnit: 'g' }, audit)).rejects.toThrow('MATERIAL_UNIT_VERSION_REQUIRED');
  });
  it('locks before read, saves a new version and audits old/new units', async () => {
    const { tx, current } = fixture(); const stamp = current.updatedAt.toISOString();
    const saved = await MaterialMasterService.update(17, { baseUnit: 'g', expectedUpdatedAt: stamp }, audit);
    expect(saved.baseUnit).toBe('g'); expect((saved as any).baseUnitEditable).toBe(true);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.material.findUnique.mock.invocationCallOrder[0]);
    expect(tx.material.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 17, updatedAt: new Date(stamp) }) }));
    expect(current.updatedAt.getTime()).toBeGreaterThan(Date.parse(stamp));
    const details = JSON.parse(tx.auditLog.create.mock.calls[0][0].data.details);
    expect(details.beforeBaseUnit).toBe('kg'); expect(details.afterBaseUnit).toBe('g');
  });
  it('allows descriptive updates with the unchanged locked unit', async () => {
    fixture({ status: 'active', isTemporary: false });
    const saved = await MaterialMasterService.update(17, { nameZh: 'Corrected name', baseUnit: ' kg ' }, audit);
    expect(saved.baseUnit).toBe('kg'); expect((saved as any).baseUnitEditable).toBe(false);
  });
  it('rejects stale versions and failed compare-and-swap without an audit', async () => {
    const { tx } = fixture();
    await expect(MaterialMasterService.update(17, { baseUnit: 'g', expectedUpdatedAt: '2025-01-01T00:00:00Z' }, audit)).rejects.toThrow('MATERIAL_CONCURRENT_UPDATE');
    tx.material.updateMany.mockResolvedValue({ count: 0 });
    await expect(MaterialMasterService.update(17, { nameZh: 'Corrected name' }, audit)).rejects.toThrow('MATERIAL_CONCURRENT_UPDATE');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not permit a return to draft to bypass frozen units', async () => {
    fixture({ status: 'active', isTemporary: false });
    await expect(MaterialMasterService.update(17, { status: 'draft', baseUnit: 't' }, audit)).rejects.toThrow('MATERIAL_STATUS_TRANSITION');
  });
});

import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { assertLatestQualityRelease, ProductionQualityService } from './production-quality.service';

jest.mock('../config/database', () => ({
  __esModule: true,
  default: { $transaction: jest.fn() },
}));

const transactionMock = prisma.$transaction as jest.Mock;

describe('structured production quality lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocks work-order completion until the latest inspection is independently released and passing', async () => {
    const tx = { productionQualityCheck: { findFirst: jest.fn().mockResolvedValue({ status: 'submitted', result: 'pass' }) } } as any;
    await expect(assertLatestQualityRelease(tx, 5, 2)).rejects.toThrow('WORK_ORDER_QUALITY_RELEASE_REQUIRED');
    tx.productionQualityCheck.findFirst.mockResolvedValue({ status: 'released', result: 'pass' });
    await expect(assertLatestQualityRelease(tx, 5, 2)).resolves.toBeUndefined();
  });

  it('derives pass/fail from immutable BOM limits instead of trusting a client result', async () => {
    const create = jest.fn().mockImplementation(({ data }) => ({ id: 90, ...data, measurements: data.measurements.create }));
    const tx = {
      productionWorkOrder: { findUnique: jest.fn().mockResolvedValue({
        id: 5,
        workOrderNo: 'WO-5',
        status: 'qc_pending',
        batchId: null,
        bom: { qualityCharacteristics: [
          { id: 10, code: 'PH', name: 'pH', valueType: 'numeric', unit: null, lowerLimit: new Prisma.Decimal('7.0'), upperLimit: new Prisma.Decimal('8.0'), targetText: null, testMethod: 'pH meter', required: true },
          { id: 11, code: 'APPEARANCE', name: '外观', valueType: 'text', unit: null, lowerLimit: null, upperLimit: null, targetText: '合格|通过', testMethod: '目测', required: true },
        ] },
        qualityChecks: [],
      }) },
      productionQualityCheck: { create },
      productBatch: { update: jest.fn() },
    } as any;
    transactionMock.mockImplementation((callback: (client: any) => unknown) => callback(tx));

    const result = await ProductionQualityService.submitInspection(5, {
      sampleNo: 'S-001',
      defectRate: 0,
      measurements: [
        { characteristicId: 10, measuredNumeric: '8.1' },
        { characteristicId: 11, measuredText: '合格' },
      ],
    }, { userId: 7, username: 'inspector-a' });

    expect(result.result).toBe('fail');
    expect(result.defectRate).toBe(50);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'submitted',
      disposition: 'hold',
      inspectorUserId: 7,
      checkedBy: 'inspector-a',
      result: 'fail',
    }) }));
  });

  it('rejects duplicate characteristic measurements instead of silently accepting the last value', async () => {
    const tx = {
      productionWorkOrder: { findUnique: jest.fn().mockResolvedValue({
        id: 5,
        workOrderNo: 'WO-5',
        status: 'qc_pending',
        batchId: null,
        bom: { qualityCharacteristics: [
          { id: 10, code: 'PH', name: 'pH', valueType: 'numeric', unit: null, lowerLimit: new Prisma.Decimal('7.0'), upperLimit: new Prisma.Decimal('8.0'), targetText: null, testMethod: 'pH meter', required: true },
        ] },
        qualityChecks: [],
      }) },
    } as any;
    transactionMock.mockImplementation((callback: (client: any) => unknown) => callback(tx));

    await expect(ProductionQualityService.submitInspection(5, {
      sampleNo: 'S-DUPLICATE',
      measurements: [
        { characteristicId: 10, measuredNumeric: '7.1' },
        { characteristicId: 10, measuredNumeric: '9.9' },
      ],
    }, { userId: 7, username: 'inspector-a' })).rejects.toThrow('QC_DUPLICATE_MEASUREMENT');
  });

  it('rejects self-release even when the account owns both permissions', async () => {
    const tx = {
      productionQualityCheck: { findFirst: jest.fn().mockResolvedValue({
        id: 9,
        workOrderId: 5,
        revision: 1,
        status: 'submitted',
        result: 'pass',
        inspectorUserId: 7,
        workOrder: { batchId: null },
        measurements: [],
      }) },
    } as any;
    transactionMock.mockImplementation((callback: (client: any) => unknown) => callback(tx));

    await expect(ProductionQualityService.reviewInspection(5, 9, {
      decision: 'release',
      reviewNote: '复核合格',
    }, { userId: 7, username: 'inspector-a' })).rejects.toThrow('QC_SEGREGATION_OF_DUTIES_REQUIRED');
  });

  it('releases only the latest passing revision and stamps reviewer identity', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      productionQualityCheck: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 9, workOrderId: 5, revision: 2, status: 'submitted', result: 'pass', inspectorUserId: 7, workOrder: { batchId: 21 }, measurements: [] })
          .mockResolvedValueOnce(null),
        updateMany,
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          checkNo: 'QC-WO-5-R2',
          result: 'pass',
          status: 'released',
          disposition: 'released',
          reviewedByUserId: 8,
          reviewedBy: 'reviewer-b',
          measurements: [],
        }),
      },
      productBatch: { update: jest.fn().mockResolvedValue({ id: 21 }) },
    } as any;
    transactionMock.mockImplementation((callback: (client: any) => unknown) => callback(tx));

    const result = await ProductionQualityService.reviewInspection(5, 9, {
      decision: 'release',
      reviewNote: '第二人复核仪器与留样，允许放行',
    }, { userId: 8, username: 'reviewer-b' });

    expect(result.status).toBe('released');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      reviewedByUserId: 8,
      reviewedBy: 'reviewer-b',
      disposition: 'released',
    }) }));
    expect(tx.productBatch.update).toHaveBeenCalledWith({ where: { id: 21 }, data: { qualityStatus: 'released' } });
  });

  it('fails closed when another reviewer wins the submitted-state claim', async () => {
    const tx = {
      productionQualityCheck: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 9, workOrderId: 5, revision: 1, status: 'submitted', result: 'pass', inspectorUserId: 7, workOrder: { batchId: null }, measurements: [] })
          .mockResolvedValueOnce(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as any;
    transactionMock.mockImplementation((callback: (client: any) => unknown) => callback(tx));

    await expect(ProductionQualityService.reviewInspection(5, 9, {
      decision: 'release',
      reviewNote: '并发复核',
    }, { userId: 8, username: 'reviewer-b' })).rejects.toThrow('QC_REVIEW_ALREADY_DECIDED');
  });
});

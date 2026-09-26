jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    materialGovernanceRun: { findFirst: jest.fn() },
    productionBomItem: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from '../config/database';
import {
  buildBomBackfillFingerprint,
  buildBomBackfillSourceKey,
  MaterialGovernanceService,
} from './material-governance.service';
import { applyBomBackfillSchema } from '../validators/material';

describe('material governance concurrency contract', () => {
  const source = {
    materialName: '  水性丙烯酸乳液 A  ',
    materialCode: ' rm-acr/001 ',
    unit: ' KG ',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes multilingual source identity without losing Unicode', () => {
    expect(buildBomBackfillSourceKey(source)).toBe('RM-ACR/001|水性丙烯酸乳液 a|kg');
  });

  it('fingerprints the exact row set independently of query ordering', () => {
    expect(buildBomBackfillFingerprint(source, [9, 2, 7]))
      .toBe(buildBomBackfillFingerprint(source, [7, 9, 2]));
    expect(buildBomBackfillFingerprint(source, [9, 2, 7]))
      .not.toBe(buildBomBackfillFingerprint(source, [9, 2, 8]));
  });

  it('rejects a mapping without the preview fingerprint', () => {
    const result = applyBomBackfillSchema.safeParse({
      mappings: [{
        source,
        materialId: 17,
        expectedCount: 3,
      }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts only bounded mappings with a SHA-256 fingerprint', () => {
    const result = applyBomBackfillSchema.safeParse({
      mappings: [{
        source,
        materialId: 17,
        expectedCount: 3,
        expectedFingerprint: 'a'.repeat(64),
      }],
    });
    expect(result.success).toBe(true);
  });

  it('does not report idempotent success when an applied run has drifted', async () => {
    (prisma.materialGovernanceRun.findFirst as jest.Mock).mockResolvedValue({
      id: 9,
      runNo: 'MAT-BF-9',
      changes: [
        { entityId: 101, afterValue: '17' },
        { entityId: 102, afterValue: '17' },
      ],
      _count: { changes: 2 },
    });
    (prisma.productionBomItem.count as jest.Mock).mockResolvedValue(1);

    await expect(MaterialGovernanceService.applyBomBackfill([{
      source,
      materialId: 17,
      expectedCount: 2,
      expectedFingerprint: 'a'.repeat(64),
    }], { userId: 1 })).rejects.toThrow('MATERIAL_BACKFILL_IDEMPOTENCY_STATE_DRIFT');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

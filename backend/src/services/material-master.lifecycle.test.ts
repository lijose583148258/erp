jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
  },
}));

import prisma from '../config/database';
import { MaterialMasterService } from './material-master.service';

describe('material master lifecycle boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps retired material history immutable', async () => {
    const tx = {
      material: {
        findUnique: jest.fn().mockResolvedValue({
          id: 17,
          code: 'RM-RETIRED-001',
          status: 'retired',
          updatedAt: new Date('2026-07-29T00:00:00.000Z'),
        }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async callback => callback(tx));

    await expect(MaterialMasterService.update(
      17,
      { nameZh: '不应被写入的名称' },
      { userId: 1 },
    )).rejects.toThrow('MATERIAL_RETIRED');
    expect(tx.material.update).not.toHaveBeenCalled();
    expect(tx.material.updateMany).not.toHaveBeenCalled();
  });
});

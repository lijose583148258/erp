jest.mock('../config/database', () => ({
  __esModule: true,
  default: {},
}));

import { CreditEngine } from './CreditEngine';

describe('CreditEngine transaction boundary', () => {
  it('uses the supplied transaction client for exposure and blocks an over-limit order', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      creditLimit: 100,
      creditHold: false,
      creditHoldReason: null,
      collectionsStatus: 'normal',
      dunningLevel: 0,
    });
    const findMany = jest.fn().mockResolvedValue([
      { finalAmount: 60, paidAmount: 0 },
    ]);
    const tx = {
      customer: { findUnique },
      order: { findMany },
    } as never;

    const result = await CreditEngine.checkOrder(7, 50, tx);

    expect(result.allow).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ customerId: 7 }),
    }));
  });
});

import {
  addMoney,
  calculateRatio,
  compareMoney,
  maxMoney,
  minMoney,
  multiplyMoney,
  prorateMoney,
  roundMoney,
  subtractMoney,
} from './money';

describe('money precision boundary', () => {
  it('uses decimal half-up rounding rather than binary toFixed behavior', () => {
    expect(roundMoney('1.005')).toBe(1.01);
    expect(roundMoney('-1.005')).toBe(-1.01);
  });

  it('keeps additions, subtraction, and multiplication at currency precision', () => {
    expect(addMoney('0.1', '0.2')).toBe(0.3);
    expect(subtractMoney('1000', '333.33', '666.67')).toBe(0);
    expect(multiplyMoney('0.1', '0.2', '100')).toBe(2);
  });

  it('compares and selects values after currency quantization', () => {
    expect(compareMoney('10.004', '10.00')).toBe(0);
    expect(compareMoney('10.005', '10.00')).toBe(1);
    expect(minMoney('9.999', '10.01')).toBe(10);
    expect(maxMoney('9.999', '10.01')).toBe(10.01);
  });

  it('prorates money and calculates stable non-money ratios without binary float drift', () => {
    expect(prorateMoney('100.01', '1', '3')).toBe(33.34);
    expect(prorateMoney('0.3', '1', '3')).toBe(0.1);
    expect(calculateRatio('1', '3')).toBe(0.333333);
    expect(calculateRatio('10', '0')).toBe(0);
    expect(() => prorateMoney('100', '1', '0')).toThrow(/denominator/);
  });

  it('rejects non-finite values instead of persisting an invalid amount', () => {
    expect(() => roundMoney(Number.NaN)).toThrow(/must be finite/);
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow(/must be finite/);
  });
});

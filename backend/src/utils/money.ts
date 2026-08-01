import { Prisma } from '@prisma/client';

export type DecimalInput = Prisma.Decimal | string | number | bigint | null | undefined;

const toDecimal = (value: DecimalInput): Prisma.Decimal => {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(0);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Money value must be finite: ${value}`);
  }
  return new Prisma.Decimal(String(value));
};

export const moneyDecimal = (value: DecimalInput): Prisma.Decimal =>
  toDecimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const roundMoney = (value: DecimalInput): number => moneyDecimal(value).toNumber();

export const addMoney = (...values: DecimalInput[]): number => roundMoney(
  values.reduce<Prisma.Decimal>((sum, value) => sum.plus(toDecimal(value)), new Prisma.Decimal(0)),
);

export const subtractMoney = (minuend: DecimalInput, ...subtrahends: DecimalInput[]): number => roundMoney(
  subtrahends.reduce<Prisma.Decimal>((result, value) => result.minus(toDecimal(value)), toDecimal(minuend)),
);

export const multiplyMoney = (...values: DecimalInput[]): number => roundMoney(
  values.reduce<Prisma.Decimal>((product, value) => product.times(toDecimal(value)), new Prisma.Decimal(1)),
);

export const compareMoney = (left: DecimalInput, right: DecimalInput): number =>
  moneyDecimal(left).comparedTo(moneyDecimal(right));

export const minMoney = (...values: DecimalInput[]): number => {
  if (!values.length) return 0;
  return roundMoney(values.reduce<Prisma.Decimal>((minimum, value) => {
    const candidate = moneyDecimal(value);
    return candidate.lessThan(minimum) ? candidate : minimum;
  }, moneyDecimal(values[0])));
};

export const maxMoney = (...values: DecimalInput[]): number => {
  if (!values.length) return 0;
  return roundMoney(values.reduce<Prisma.Decimal>((maximum, value) => {
    const candidate = moneyDecimal(value);
    return candidate.greaterThan(maximum) ? candidate : maximum;
  }, moneyDecimal(values[0])));
};

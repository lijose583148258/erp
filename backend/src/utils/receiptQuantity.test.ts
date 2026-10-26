import { compareReceiptQuantity } from './receiptQuantity';

test.each([[0, 0], [-0, 0], [0.1 + 0.2, 0.3], [0.2 + 0.1, 0.3], [0.3 - 0.1, 0.2], [1e9, 1e9]])(
  'ordinary float noise compares equal: %s versus %s', (left, right) => {
    expect(compareReceiptQuantity(left, right) === 0).toBe(true);
    expect(compareReceiptQuantity(right, left) === 0).toBe(true);
  });

test.each([[0.000001, 0], [0.000002, 0.000001], [1.000001, 1], [1, 0.999999],
  [1e9 + 0.000001, 1e9], [1e9, 1e9 - 0.000001]])('a real six-place difference is preserved: %s greater than %s', (left, right) => {
  expect(compareReceiptQuantity(left, right)).toBe(1);
  expect(compareReceiptQuantity(right, left)).toBe(-1);
});

test.each([[0.0000001, 0], [0.00000001, 0], [0.00000010000001, 0.0000001], [0.1234567, 0.1234566]])(
  'finer legacy quantities keep their actual nonzero ordering: %s versus %s', (left, right) => {
    expect(compareReceiptQuantity(left, right)).toBe(1);
    expect(compareReceiptQuantity(right, left)).toBe(-1);
  });

test('finer legacy arithmetic noise remains compatible, without rounding the real value to six places', () => {
  expect(compareReceiptQuantity(0.0000001 + 0.0000002, 0.0000003)).toBe(0);
  expect(compareReceiptQuantity(0.0000003, 0)).toBe(1);
});

test.each([NaN, Infinity, -Infinity])('non-finite quantity %s is rejected on either side', bad => {
  expect(() => compareReceiptQuantity(bad, 1)).toThrow('INVALID_RECEIPT_QUANTITY');
  expect(() => compareReceiptQuantity(1, bad)).toThrow('INVALID_RECEIPT_QUANTITY');
});

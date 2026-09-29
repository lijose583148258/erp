// Shared, dependency-free browser/server contract. V1 is immutable: future
// semantics require another mode, never reinterpret a frozen BOM's saved tuple.
export const MASS_PERCENTAGE_V1 = 'mass_percentage_v1';
const scales: Record<string, bigint> = { mg: 1n, g: 1000n, kg: 1000000n, t: 1000000000n,
  毫克: 1n, 克: 1000n, 千克: 1000000n, 公斤: 1000000n, 吨: 1000000000n };
const error = (code: string, detail: string): never => { throw new Error(`BOM_UNIT_${code}:${detail}`); };
const fraction = (value: unknown): [bigint, bigint] => {
  const text = String(value ?? '').trim().replace(/^\./, '0.');
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || text.length > 40) return error('NUMBER_INVALID', '换算数量必须是非负有限十进制数');
  const exponent = Number(match[3] || 0) - (match[2]?.length || 0);
  if (Math.abs(exponent) > 18) return error('PRECISION_UNSUPPORTED', '换算数字精度超出 v1 范围');
  const numerator = BigInt(match[1] + (match[2] || ''));
  return exponent >= 0 ? [numerator * 10n ** BigInt(exponent), 1n] : [numerator, 10n ** BigInt(-exponent)];
};
const quantityFromRatio = (n: bigint, d: bigint): number => {
  const scaled = n * 1000000n;
  if (n <= 0n || scaled % d !== 0n) return error('PRECISION_UNSUPPORTED', '换算结果必须精确到库存 6 位小数；禁止静默舍入或归零');
  const micros = scaled / d;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) return error('QUANTITY_TOO_LARGE', '换算结果超出安全计量范围');
  const result = Number(micros) / 1000000;
  const [actual, divisor] = fraction(result);
  if (actual * 1000000n !== micros * divisor) return error('PRECISION_UNSUPPORTED', '换算结果无法无损保存');
  return result;
};

export const massPercentageQuantityV1 = (percentage: unknown, inputUnit: string, outputUnit: string): number => {
  const scale = (unit: string) => { const key = unit.trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(scales, key) ? scales[key] : undefined; };
  const input = scale(inputUnit), output = scale(outputUnit);
  if (!input || !output) return error('MASS_BASIS_REQUIRED', '质量换算 v1 仅支持 mg/g/kg/t；包装和体积须另有受控依据');
  const [n, d] = fraction(percentage);
  if (n <= 0n || n > 100n * d) return error('PERCENTAGE_INVALID', '质量百分比必须大于 0 且不超过 100');
  return quantityFromRatio(n * output, d * 100n * input);
};

export const massRequiredQuantityV1 = (quantityPerUnit: unknown, outputQuantity: unknown, lossRate: unknown = 0): number => {
  const [q, qd] = fraction(quantityPerUnit), [o, od] = fraction(outputQuantity), [loss, ld] = fraction(lossRate ?? 0);
  return quantityFromRatio(q * o * (100n * ld + loss), qd * od * 100n * ld);
};

export const assertMassSnapshotV1 = (item: { unit: string; percentage?: unknown; quantityPerUnit?: unknown }, outputUnit: string) => {
  const expected = massPercentageQuantityV1(item.percentage, item.unit, outputUnit);
  if (Number(item.quantityPerUnit) !== expected) error('MASS_SNAPSHOT_MISMATCH', '冻结的质量换算单耗与 v1 依据不一致，禁止继续生产');
};

// Default object also supports the frontend ESM test runner importing this CommonJS package.
export default { MASS_PERCENTAGE_V1, massPercentageQuantityV1, massRequiredQuantityV1, assertMassSnapshotV1 };

import type { IncomingQualityPlan, PurchaseOrder, SupplierPayableTerms } from '../../services/procurement.service';

export interface PurchaseSourceFields {
  taxTreatment: SupplierPayableTerms['taxTreatment'] | ''; supplierTaxAmount: string; supplierChargesAmount: string; evidenceRef: string;
  specificationRef: string; specificationRevision: string;
  characteristics: Array<{ code: string; name: string; valueType: 'numeric' | 'text'; unit: string;
    lowerLimit: string; upperLimit: string; targetText: string; testMethod: string; required: boolean }>;
}
export const newIncomingQualityCharacteristic = (): PurchaseSourceFields['characteristics'][number] => ({
  code: '', name: '', valueType: 'numeric', unit: '', lowerLimit: '', upperLimit: '', targetText: '', testMethod: '', required: true,
});
export function purchaseSourceFieldsFrom(order: PurchaseOrder): PurchaseSourceFields {
  const parse = (value?: string | null) => { try { return JSON.parse(value || ''); } catch { return null; } };
  const payable = parse(order.supplierPayableBasisJson), quality = parse(order.incomingQualityPlanJson);
  const terms = payable?.schema === 'supplier-payable-basis/v1' ? payable.terms : null;
  const plan = quality?.schema === 'purchase-incoming-quality/v1' ? quality.plan : null;
  const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return { taxTreatment: ['included_in_price', 'additional_supplier_tax', 'none_or_third_party'].includes(terms?.taxTreatment) ? terms.taxTreatment : '',
    supplierTaxAmount: text(terms?.supplierTaxAmount), supplierChargesAmount: text(terms?.supplierChargesAmount), evidenceRef: text(terms?.evidenceRef),
    specificationRef: text(plan?.specificationRef), specificationRevision: text(plan?.specificationRevision),
    characteristics: (Array.isArray(plan?.characteristics) ? plan.characteristics : []).map((value: unknown) => {
      const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      return { code: text(row.code), name: text(row.name), valueType: row.valueType === 'text' ? 'text' as const : 'numeric' as const, unit: text(row.unit),
        lowerLimit: text(row.lowerLimit), upperLimit: text(row.upperLimit), targetText: text(row.targetText), testMethod: text(row.testMethod), required: row.required === true };
    }) };
}
export function buildPurchaseSourceInput(fields: PurchaseSourceFields): { supplierPayableTerms: SupplierPayableTerms; incomingQualityPlan: IncomingQualityPlan } {
  const error = (message: string): never => { throw new Error(message); };
  const money = (raw: string) => {
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n) || n < 0 || Number(n.toFixed(2)) !== n || !Number.isSafeInteger(Math.round(n * 100))) {
      return error('供应商应付税额及费用须明确填写为有效两位小数；无费用请填写 0');
    }
    return n;
  };
  if (!fields.taxTreatment || fields.evidenceRef.trim().length < 3) error('请选择税费归属并填写实际供应商报价凭据');
  const supplierTaxAmount = money(fields.supplierTaxAmount), supplierChargesAmount = money(fields.supplierChargesAmount);
  if (fields.taxTreatment !== 'additional_supplier_tax' && supplierTaxAmount !== 0) error('价内税或第三方税费不能再次增加供应商应付');
  if (fields.specificationRef.trim().length < 3 || !fields.specificationRevision.trim()) error('请填写实际检验规范编号及版本');
  if (!fields.characteristics.length || fields.characteristics.length > 100 || !fields.characteristics.some(row => row.required)) error('配置 1 至 100 个实际检验项，至少一个必检；不得以“不需检验”替代来料 QA 放行');
  const codes = fields.characteristics.map(row => row.code.trim().toUpperCase());
  if (new Set(codes).size !== codes.length) error('检验项目编码不能重复');
  const characteristics = fields.characteristics.map((row, index) => {
    if (!row.code.trim() || !row.name.trim() || !row.testMethod.trim()) error('每项检验必须填写编码、名称和实际检验方法');
    const numeric = (value: string) => value.trim() ? Number.isFinite(Number(value)) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) : true;
    if (row.valueType === 'numeric' && ((!row.lowerLimit.trim() && !row.upperLimit.trim()) || !numeric(row.lowerLimit) || !numeric(row.upperLimit)
      || (row.lowerLimit.trim() && row.upperLimit.trim() && Number(row.lowerLimit) > Number(row.upperLimit)))) error('数值检验须有有效上下限，至少填写一侧');
    if (row.valueType === 'text' && !row.targetText.split('|').some(value => value.trim())) error('文本检验须明确列出允许的合格值');
    return { code: codes[index], name: row.name.trim(), valueType: row.valueType, unit: row.unit.trim() || null,
      lowerLimit: row.valueType === 'numeric' ? row.lowerLimit.trim() || null : null,
      upperLimit: row.valueType === 'numeric' ? row.upperLimit.trim() || null : null,
      targetText: row.valueType === 'text' ? row.targetText.trim() : null, testMethod: row.testMethod.trim(), required: row.required, sortOrder: index };
  });
  return { supplierPayableTerms: { taxTreatment: fields.taxTreatment as SupplierPayableTerms['taxTreatment'], supplierTaxAmount, supplierChargesAmount, evidenceRef: fields.evidenceRef.trim() },
    incomingQualityPlan: { specificationRef: fields.specificationRef.trim(), specificationRevision: fields.specificationRevision.trim(), characteristics } };
}

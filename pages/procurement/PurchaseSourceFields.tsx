import type { Dispatch, SetStateAction } from 'react';
import { FormField } from '../../components/ui';
import { newIncomingQualityCharacteristic, type PurchaseSourceFields as Fields } from './purchaseSourceForm';

const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-transparent px-3 text-sm dark:border-slate-700';
export function PurchaseSourceFields({ fields, setFields, currency, disabled }: {
  fields: Fields; setFields: Dispatch<SetStateAction<Fields>>; currency: string; disabled: boolean;
}) {
  const patch = (index: number, change: Partial<Fields['characteristics'][number]>) => setFields(current => ({ ...current,
    characteristics: current.characteristics.map((row, i) => i === index ? { ...row, ...change } : row) }));
  return <fieldset disabled={disabled} className="mt-5 space-y-4 rounded-2xl border p-4" data-testid="purchase-source-fields">
    <legend className="px-2 font-bold">供应商应付与来料检验来源</legend>
    <p className="text-sm text-slate-600 dark:text-slate-300">应付使用实际供应商报价及原币税费，不套用库存落地成本。实收不代表检验合格；QC 测量、独立 QA 放行后才允许付款。</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">税费归属<select data-testid="purchase-source-tax-treatment" className={inputClass} value={fields.taxTreatment}
        onChange={event => setFields(current => ({ ...current, taxTreatment: event.target.value as Fields['taxTreatment'],
          supplierTaxAmount: event.target.value === 'additional_supplier_tax' ? current.supplierTaxAmount : '0' }))}>
        <option value="">请选择实际归属</option><option value="included_in_price">价内税，不重复加应付</option>
        <option value="additional_supplier_tax">另付供应商税款</option><option value="none_or_third_party">无税或税费支付第三方</option>
      </select></label>
      <FormField label="供应商报价/凭据编号" dataTestId="purchase-source-evidence" value={fields.evidenceRef} onChange={value => setFields(current => ({ ...current, evidenceRef: value }))} />
      <FormField label={`另付供应商税款（${currency}）`} dataTestId="purchase-source-supplier-tax" type="number" value={fields.supplierTaxAmount} onChange={value => setFields(current => ({ ...current, supplierTaxAmount: value }))} />
      <FormField label={`供应商其他费用（${currency}，无费用填 0）`} dataTestId="purchase-source-supplier-charges" type="number" value={fields.supplierChargesAmount} onChange={value => setFields(current => ({ ...current, supplierChargesAmount: value }))} />
      <FormField label="来料检验规范编号" dataTestId="purchase-source-specification" value={fields.specificationRef} onChange={value => setFields(current => ({ ...current, specificationRef: value }))} />
      <FormField label="规范版本" dataTestId="purchase-source-specification-revision" value={fields.specificationRevision} onChange={value => setFields(current => ({ ...current, specificationRevision: value }))} />
    </div>
    {fields.characteristics.map((row, index) => <section key={index} className="rounded-xl border p-3" data-testid={`purchase-source-characteristic-${index}`}>
      <div className="flex items-center justify-between gap-2"><span className="font-bold">检验项 {index + 1}</span>
        <button type="button" className="min-h-10 rounded-lg border px-3 text-sm" aria-label={`删除来料检验项 ${index + 1}`}
          onClick={() => setFields(current => ({ ...current, characteristics: current.characteristics.filter((_, i) => i !== index) }))}>删除</button></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FormField label="项目编码" dataTestId={`purchase-source-code-${index}`} value={row.code} onChange={value => patch(index, { code: value.toUpperCase() })} />
        <FormField label="项目名称" dataTestId={`purchase-source-name-${index}`} value={row.name} onChange={value => patch(index, { name: value })} />
        <label className="text-sm">判定类型<select className={inputClass} data-testid={`purchase-source-type-${index}`} value={row.valueType}
          onChange={event => patch(index, { valueType: event.target.value as 'numeric' | 'text' })}><option value="numeric">数值范围</option><option value="text">文本合格值</option></select></label>
        <FormField label="测量单位（无单位留空）" dataTestId={`purchase-source-unit-${index}`} value={row.unit} onChange={value => patch(index, { unit: value })} />
        {row.valueType === 'numeric' ? <>
          <FormField label="合格下限" dataTestId={`purchase-source-lower-${index}`} value={row.lowerLimit} onChange={value => patch(index, { lowerLimit: value })} />
          <FormField label="合格上限" dataTestId={`purchase-source-upper-${index}`} value={row.upperLimit} onChange={value => patch(index, { upperLimit: value })} />
        </> : <FormField label="合格值（多个值用 | 分隔）" dataTestId={`purchase-source-target-${index}`} value={row.targetText} onChange={value => patch(index, { targetText: value })} />}
        <FormField label="实际检验方法" dataTestId={`purchase-source-method-${index}`} value={row.testMethod} onChange={value => patch(index, { testMethod: value })} />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={row.required} onChange={event => patch(index, { required: event.target.checked })} />必检项目</label>
      </div>
    </section>)}
    <button type="button" data-testid="purchase-source-add-characteristic" disabled={fields.characteristics.length >= 100} className="min-h-11 rounded-xl border px-3 font-bold"
      onClick={() => setFields(current => ({ ...current, characteristics: [...current.characteristics, newIncomingQualityCharacteristic()] }))}>新增实际检验项目</button>
  </fieldset>;
}

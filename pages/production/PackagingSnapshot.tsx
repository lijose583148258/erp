import React from 'react';
import packagingBasis from '../../backend/src/domain/production-packaging-basis';

export function PackagingSnapshot({ json }: { json: string }) {
  try {
    const basis = packagingBasis.parsePackagingBasis(json);
    return <section className="col-span-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900" data-testid="packaging-bom-snapshot">
      <h4 className="font-semibold">冻结包装依据 · {basis.specCode} / {basis.version}</h4>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><dt className="text-slate-500">每包装净质量</dt><dd>{basis.netMass} {basis.massUnit}/{basis.packageUnit}</dd></div>
        <div><dt className="text-slate-500">独立批准</dt><dd>用户 #{basis.approvedBy} · {new Date(basis.approvedAt).toLocaleString('zh-CN')}</dd></div>
        <div className="break-words sm:col-span-2"><dt className="text-slate-500">来源依据</dt><dd>{basis.sourceReference}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">仅整包装；质量换算规则 v1。后续新版本或停用不改写此 BOM 的历史依据。</p>
    </section>;
  } catch {
    return <p role="alert" className="col-span-full text-sm text-red-600">包装冻结依据无效，禁止按此配方投产，请联系管理员核查。</p>;
  }
}

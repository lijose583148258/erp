export function BarterInputRoadmap() {
  return (
    <section className="rounded-[32px] border border-blue-100 bg-blue-50/60 p-5 shadow-[0_12px_30px_rgba(37,99,235,0.08)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black text-blue-600">录入路径回读</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">货抵录入路线图</h2>
        </div>
        <span className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-black text-blue-700">保存后请刷新核对回读</span>
      </div>
      <div className="overflow-hidden rounded-[24px] border border-blue-100 bg-white/80">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-blue-600 text-xs font-black uppercase tracking-[0.16em] text-white">
            <tr>
              <th className="px-4 py-3">阶段</th>
              <th className="px-4 py-3">输入对象</th>
              <th className="px-4 py-3">关键字段</th>
              <th className="px-4 py-3">保存后证据</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-blue-50 font-bold text-slate-600">
            <tr>
              <td className="px-4 py-3 text-slate-950">协议主档</td>
              <td className="px-4 py-3">客户、对方、结算模式、币种、协议日、估值日</td>
              <td className="px-4 py-3">双方总标的、数量、单价、质量/损耗系数</td>
              <td className="px-4 py-3">协议编号、可抵总额、剩余待抵</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-slate-950">分批抵扣明细</td>
              <td className="px-4 py-3">已选协议下的本次执行批次</td>
              <td className="px-4 py-3">本次交付、本次抵扣、关联订单、估值快照</td>
              <td className="px-4 py-3">批次号、本次可抵、创建后预计剩余</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-slate-950">入账/反冲台账</td>
              <td className="px-4 py-3">批次审核、过账、反冲</td>
              <td className="px-4 py-3">过账金额、反冲原因、状态边界</td>
              <td className="px-4 py-3">已过账金额、冲销状态、台账流水</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

import { DocumentInputGuide } from '../../components/ui/DocumentInputGuide';

export const ProcurementInputGuide = () => (
  <DocumentInputGuide
    testId="procurement-input-guide"
    eyebrow="采购 / 供应商 / 收货路线"
    title="供应商、采购单、收货动作必须分清"
    description="采购页不能把供应商建档、采购开单、分批收货、入库、差异处理混成一个大表。成熟进销存习惯是先维护供应商，再开采购单和明细行，到货后按批次收货并回写库存；短收、拒收、质检差异再进入差异/RMA链。"
    tone="amber"
    steps={[
      { title: '供应商主数据', description: '维护供应商多名称、多地址、多联系人和账期，不在这里做收货。', badge: '主数据' },
      { title: '采购单', description: '录采购单头和物料明细，确认数量、单价、币种、交期。', badge: '开单' },
      { title: '分批收货', description: '按到货批次收货，保存后必须回读采购单状态和库存入库。', badge: '执行' },
      { title: '差异闭环', description: '短收、拒收、质量问题进入差异处理或 RMA，不直接改采购单历史。', badge: '异常' },
    ]}
    boundaries={[
      { title: '本区负责', items: ['供应商', '采购单', '采购明细', '分批收货', '入库关联'] },
      { title: '转入其他区', items: ['库存调拨', '财务付款', '异常线索复核', 'RMA补偿'] },
    ]}
    evidence={['供应商能查到', '采购单能回读', '收货后库存变化', '差异能追踪']}
  />
);

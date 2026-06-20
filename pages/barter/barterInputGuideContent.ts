export const barterInputGuideSteps = [
  {
    title: '协议主档',
    badge: 'MASTER',
    description: '先录客户、对方、币种、协议日、估值日和双方总标的，只定义可抵总额，不登记本次履约。',
  },
  {
    title: '分批抵扣明细',
    badge: 'BATCH',
    description: '选中协议后再录本批关联订单、估值日、本次对方交付和本次我方抵扣，系统按较小货值计算本次可抵金额。',
  },
  {
    title: '入账/反冲台账',
    badge: 'LEDGER',
    description: '批次先审核再过账，发现错误走反冲并填写原因，保留原批次和反冲痕迹。',
  },
  {
    title: '回读证据',
    badge: 'READBACK',
    description: '保存后回到协议列表和批次流水，核对已抵、待抵、批次状态、过账金额和冲销状态。',
  },
];

export const barterInputBoundaries = [
  {
    title: '不要混在一个输入框里的信息',
    items: ['协议总额', '本次交付', '本次抵扣', '财务过账', '反冲原因'],
  },
  {
    title: '必须能回读的证据',
    items: ['valuation snapshot', 'partial delivery', 'partial offset', 'stock closure', 'reverse'],
  },
];

export const barterInputEvidence = ['协议编号', '剩余待抵', '批次流水', '过账金额', '反冲原因'];

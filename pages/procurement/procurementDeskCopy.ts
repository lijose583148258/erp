export type ProcurementDeskCopy = {
  eyebrow: string;
  title: string;
  description: string;
  suppliers: {
    title: string;
    subtitle: string;
    purpose: string;
  };
  orders: {
    title: string;
    subtitle: string;
    purpose: string;
  };
  receipts: {
    title: string;
    subtitle: string;
    purpose: string;
  };
  principle: {
    title: string;
    subtitle: string;
    purpose: string;
  };
  receiptGuideTitle: string;
  receiptGuideBody: string;
  receiptGuideHint: string;
  principleCards: Array<[string, string]>;
};

export const getProcurementDeskCopy = (language: string): ProcurementDeskCopy => {
  if (language === 'en') {
    return {
      eyebrow: 'Procurement flow',
      title: 'Procurement responsibility navigator',
      description: 'Keep supplier master data, purchase orders, and receiving batches in separate work areas so users know where to enter each fact.',
      suppliers: {
        title: 'Supplier master',
        subtitle: 'Names, addresses, contacts',
        purpose: 'Maintain supplier identity only. Do not receive goods or post stock here.',
      },
      orders: {
        title: 'Purchase orders',
        subtitle: 'Commercial commitment',
        purpose: 'Record item, quantity, price, landed cost, and optional linked sales order.',
      },
      receipts: {
        title: 'Receiving action',
        subtitle: 'Open from order row',
        purpose: 'Post partial receipts, accepted/rejected quantity, batch number, and notes.',
      },
      principle: {
        title: 'Boundary rules',
        subtitle: 'Avoid mixed input areas',
        purpose: 'Clarify what belongs to procurement, warehouse, finance, or discrepancy handling.',
      },
      receiptGuideTitle: 'Receiving is an order action',
      receiptGuideBody: 'Select a purchase order, then click the receipt-batch button in the row actions. This keeps partial receiving attached to the exact order and avoids writing stock facts into supplier master data.',
      receiptGuideHint: 'If no receipt button appears, approve or dispatch the purchase order first.',
      principleCards: [
        ['Supplier master is not a transaction', 'Use it for identity, aliases, addresses, risk, and contacts.'],
        ['Purchase order is not stock movement', 'It records the promise. Actual receiving must be posted as receipt batches.'],
        ['Discrepancy and payable have their own ledgers', 'Shortage, rejection, and payable settlement should be reconciled downstream.'],
      ],
    };
  }

  if (language === 'vi') {
    return {
      eyebrow: 'Luồng mua hàng',
      title: 'Điều hướng trách nhiệm mua hàng',
      description: 'Tách hồ sơ nhà cung cấp, đơn mua và lô nhận hàng để người dùng biết chính xác cần nhập dữ liệu ở đâu.',
      suppliers: {
        title: 'Hồ sơ nhà cung cấp',
        subtitle: 'Tên, địa chỉ, liên hệ',
        purpose: 'Chỉ quản lý danh tính nhà cung cấp, không nhập kho tại đây.',
      },
      orders: {
        title: 'Đơn mua hàng',
        subtitle: 'Cam kết thương mại',
        purpose: 'Ghi vật tư, số lượng, giá, chi phí về kho và đơn bán liên quan nếu có.',
      },
      receipts: {
        title: 'Nhận hàng',
        subtitle: 'Mở từ dòng đơn mua',
        purpose: 'Ghi nhận từng đợt nhận, số đạt/chênh lệch, số lô và ghi chú.',
      },
      principle: {
        title: 'Quy tắc ranh giới',
        subtitle: 'Không trộn vùng nhập liệu',
        purpose: 'Phân biệt phần thuộc mua hàng, kho, tài chính và xử lý chênh lệch.',
      },
      receiptGuideTitle: 'Nhận hàng là thao tác trên đơn mua',
      receiptGuideBody: 'Chọn đơn mua rồi bấm nút lô nhận hàng trong dòng thao tác. Cách này giữ từng lần nhận gắn với đúng đơn và tránh ghi dữ liệu kho vào hồ sơ nhà cung cấp.',
      receiptGuideHint: 'Nếu chưa thấy nút nhận hàng, hãy duyệt hoặc chuyển trạng thái đơn mua trước.',
      principleCards: [
        ['Hồ sơ nhà cung cấp không phải giao dịch', 'Chỉ dùng cho danh tính, tên khác, địa chỉ, rủi ro và liên hệ.'],
        ['Đơn mua không phải nhập kho', 'Đơn mua ghi cam kết. Nhận hàng thực tế phải ghi bằng lô nhận hàng.'],
        ['Chênh lệch và công nợ có sổ riêng', 'Thiếu hàng, loại hàng và thanh toán phải đối soát ở bước sau.'],
      ],
    };
  }

  return {
    eyebrow: '采购职责分流',
    title: '采购不是一个输入框',
    description: '供应商负责主数据，订单负责采购承诺，收货从订单行进入，差异和应付留给后续台账，避免多个职责抢同一个输入区。',
    suppliers: {
      title: '供应商主数据',
      subtitle: '多名、多址、多联系人',
      purpose: '只维护供方档案，不在这里做采购入库或应付结算。',
    },
    orders: {
      title: '采购订单',
      subtitle: '询价后形成采购承诺',
      purpose: '记录采购物料、数量、价格、到岸成本和关联销售单。',
    },
    receipts: {
      title: '收货动作',
      subtitle: '从订单行打开批次抽屉',
      purpose: '分批收货、合格/差异数量、批次号和备注在这里入账。',
    },
    principle: {
      title: '边界规则',
      subtitle: '避免职责抢输入区',
      purpose: '说明哪些信息属于采购，哪些交给仓库、财务或差异处理。',
    },
    receiptGuideTitle: '收货是采购订单上的动作',
    receiptGuideBody: '先选中采购订单，再在订单行右侧点击“收货批次”。这样每次分批收货都能挂在准确订单下面，不会把库存事实写进供应商档案。',
    receiptGuideHint: '如果没有看到收货按钮，请先把采购订单审批或发运。',
    principleCards: [
      ['供应商主数据不是交易单据', '它只放身份、别名、地址、联系人、风险等级，不承载入库事实。'],
      ['采购订单不是库存流水', '订单记录承诺和成本口径，真正收货必须通过收货批次入账。'],
      ['差异与应付进入独立台账', '短收、拒收、赔付、应付结算后续由差异处理和财务模块承接。'],
    ],
  };
};

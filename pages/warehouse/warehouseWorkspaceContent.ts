type WarehouseServiceError = {
  response?: {
    data?: {
      message?: string;
    };
  };
  message?: string;
};

export const resolveWarehouseErrorMessage = (error: unknown, fallback: string) => {
  const typedError = error as WarehouseServiceError;
  return typedError.response?.data?.message || typedError.message || fallback;
};

export const warehouseInputGuideSteps = [
  {
    title: '先建仓库 / 库位主档',
    description: '新建仓库只填编码、名称、类型；进入仓库后再维护库位编码、库位名称和库位类型。',
    badge: '主档',
  },
  {
    title: '再查库存台账',
    description: '用产品、仓库、库位过滤当前余额，在库存表格里确认批次、数量、最后变动和可调拨状态。',
    badge: '表格',
  },
  {
    title: '只在受控入口做动作',
    description: '调拨从库存余额行发起，手工入库只用于盘盈 / 应急补录；数量不能超过可用余额，避免负库存。',
    badge: '动作',
  },
  {
    title: '最后回读库存流水',
    description: '保存后按 sourceRef、产品、批次或仓库 / 库位回到库存流水核对凭证号、双边调拨行和净变动。',
    badge: '回读',
  },
];

export const warehouseInputGuideBoundaries = [
  {
    title: '仓储页可以直接维护',
    items: ['仓库主档', '库位主档', '库存余额查询', '库内调拨', '盘盈 / 应急补录'],
  },
  {
    title: '必须回到来源模块办理',
    items: ['采购收货', '生产入库', '销售出库', '货抵入库 / 出库', 'RMA / 差异闭环'],
  },
];

# SalesOrders 双轨改造执行记录

- 日期：2026-04-15
- 模块：SalesOrders / 销售订单
- 目标：把原来的“一个弹窗里混着订单头和明细行”的录入方式，收口成“订单头表单 + 明细行 Excel 网格”的双轨入口。

## 一、改造前判断

### 当前形态
- `pages/SalesOrders.tsx` 通过 `SalesOrderEditorModal` 打开一个大弹窗。
- 订单头字段、OCR、价格建议、库存洞察、明细行录入混在一个组件里。
- 明细行虽然能新增、删除和填写，但还不是明确的网格式录入入口。
- 维护上最大的问题不是功能缺失，而是结构边界不清：
  - 订单头和明细行没有清晰分层
  - 表头字段和明细字段都直接写 `formData`
  - 后续要做 Excel 化、粘贴导入、键盘录入时，难以下手

### 本轮目标
1. 把订单头字段拆到独立表单区
2. 把明细行拆到独立网格区
3. 把明细行增删改复制粘贴入口收回 hook
4. 保持现有设计风格，不推翻现有外壳
5. 保证原有“新建订单 -> 保存 -> 列表回读 -> 回款 -> 回读”主链继续通过

## 二、本轮已执行改造

### 1. 订单头表单独立
- 新增 `SalesOrderHeaderForm.tsx`
- 承担订单头字段：
  - 客户
  - 账期
  - 税额模式
  - 关联合同
  - 订单备注

### 2. 明细行网格独立
- 新增 `SalesOrderLineGrid.tsx`
- 把明细行改成明确的行列表格录入：
  - 品名
  - 规格/尺寸
  - 数量
  - 单位
  - 单价
  - 折扣
  - 税额
  - 金额
  - 模式切换
  - 复制/删除动作
- 新增“粘贴 Excel”入口，支持按列顺序粘贴 TSV 文本导入明细行。

### 3. 状态层收口
- 在 `useSalesOrders.ts` 中新增并暴露：
  - `updateOrderHeader`
  - `replaceOrderItems`
  - `updateOrderItem`
  - `addOrderItem`
  - `duplicateOrderItem`
  - `removeOrderItem`
  - `importOrderItemsFromGrid`
- 这样明细行和表头不再直接各自乱写 `setFormData`，状态入口统一了。

### 4. 编辑弹窗重组
- `SalesOrderEditorModal.tsx` 重构为双栏结构：
  - 左侧：智能填单 / OCR / 订单头表单
  - 右侧：明细行网格 / 价格建议 / 库存洞察
- 保留了现有视觉语言：
  - 圆角
  - 大留白
  - 浅色卡片
  - 右侧抽屉式工作区

## 三、验证结果

### 编译验证
- `tsc --noEmit`：通过
- `npm run build`：通过

### 浏览器验收
- 运行 `npm run test:acceptance:browser`
- 结果：
  - `orders-open-create` passed
  - `orders-create-order` passed
  - `orders-created-visible` passed
  - `orders-refresh-readback` passed
  - `orders-record-payment` passed
  - `orders-payment-readback` passed

### 结论
- 本轮双轨改造没有打断销售订单主业务链。
- 新结构已经能支撑后续继续往“更接近 Excel 的录入体验”深化。

## 四、当前还没做完的下一层

### 下一轮可继续增强
1. 明细行键盘导航
   - Tab / Enter / 上下左右连续跳格
2. 整列批量粘贴
   - 不只支持 TSV 全量替换，也支持从当前行开始增量粘贴
3. 网格错误校验
   - 数量、单价、税额非法值单元格高亮
4. 订单头高级字段折叠
   - 佣金、附加项、更多合同字段折叠展示
5. 订单详情页与历史页继续对齐三轴状态
   - 单据轴 / 履约轴 / 财务轴

## 五、本轮结论

- `SalesOrders` 已完成第一轮双轨改造落地。
- 当前状态不是“纯方案”，而是：
  - 结构已拆
  - 状态已收口
  - 编译已通过
  - 浏览器主链已通过
- 可以进入下一轮更细的 Excel 化增强，而不是再回头修旧大弹窗。

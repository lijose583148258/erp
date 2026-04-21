# Adjustment / 调账中心 L3 实点测记录

- 日期：2026-04-15
- 测试对象：调账中心
- 测试入口：http://127.0.0.1:5001/#adjustment
- 测试脚本：`scripts/adjustment-browser-audit-v1.cjs`
- 证据报告：`output/playwright/adjustment-audit-report-v1.json`
- 截图目录：`output/playwright/adjustment-audit-v1/`

## 本轮修复

1. 将旧乱码组件从运行入口移除，入口改用干净组件：
   - `AdjustmentHeroClean.tsx`
   - `AdjustmentFiltersClean.tsx`
   - `AdjustmentFormClean.tsx`
2. 修复 `buildAdjustmentPayload`：前端不再把空字段发成 `null`，只发送有值字段，避免与后端 strict Zod schema 脱钩。
3. 重建 `adjustment.helpers.tsx`，恢复调账搜索、金额展示、对象标签映射。
4. 将旧乱码组件移动到隔离区：
   - `爱劳达软件治理中心/99_隔离区/adjustment-old-mojibake-components/`
5. 新增浏览器级验收脚本，覆盖创建、回读、生效、金额变化、冲销、金额恢复。

## 真实业务数据

- 订单：`ORD-1776260325342-07FB0AE827`
- 调账金额：12.34 CNY
- 创建状态：先登记 / pending
- 生效后订单 paidAmount：0 -> 12.34
- 冲销后订单 paidAmount：12.34 -> 0

## 验收步骤

1. 登录态注入。
2. API 选择可用订单。
3. 打开调账中心。
4. 浏览器真实填写财务调账单。
5. 点击创建单据。
6. API 回读 pending 调账单。
7. 浏览器点击详情区“生效”。
8. API 回读订单金额增加。
9. 浏览器填写冲销备注并点击“冲销”。
10. API 回读原单已冲销、反向单存在、订单金额恢复。

## 验收结果

- `seed-login-state`：PASS
- `pick-order-for-adjustment`：PASS
- `open-adjustment-route`：PASS
- `fill-create-pending-adjustment`：PASS
- `created-adjustment-visible`：PASS
- `verify-created-adjustment-readback`：PASS
- `apply-adjustment-ui`：PASS
- `verify-order-after-apply`：PASS
- `reverse-adjustment-ui`：PASS
- `verify-reverse-readback-and-order-restored`：PASS

结论：Adjustment 模块从“只有路由证据”升级为“L3 真实业务闭环证据”。

## 本轮发现的真实问题

1. UI 层有旧乱码组件，用户会看到“脱钩乱码”。
2. 前端提交 payload 与后端 strict schema 脱钩，空字段以 `null` 提交会导致创建失败。
3. 浏览器测试脚本选择器过宽，曾误点“已生效”筛选按钮而非详情区“生效”按钮，已修正为精确按钮名。

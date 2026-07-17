# Sales Orders Hook 减重执行记录 2026-04-21

## 本包目标

降低销售订单前端 hook 的维护成本，但不改订单创建、编辑、回款、核验、导入、发货跳转等业务行为。

## 改动内容

| 文件 | 职责 |
| --- | --- |
| `pages/sales-orders/useSalesOrders.ts` | 继续承接页面状态、API 调用、弹窗开关、订单保存和回读 |
| `pages/sales-orders/salesOrderLabels.ts` | 承接客户名称/订单客户名称显示规则 |
| `pages/sales-orders/salesOrderPermissions.ts` | 承接前端角色权限显示判断 |

## 边界原则

1. 不改 `useSalesOrders()` 的返回结构，页面调用方不需要跟着改。
2. 不改订单保存、回款、核验、导入、OCR、离线扫描逻辑。
3. 权限拆分只影响前端按钮可见性判断，不替代后端权限；后端仍是最终权限裁判。
4. 客户名称显示继续调用 `getCustomerDisplayName()`，保留中/英/越多名称兜底规则。

## 验收证据

| 验收项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `node scripts\effective-source-mojibake-gate-v1.cjs` | PASS |
| `node scripts\full-codebase-audit-v1.cjs` | WARNING，无 P0；P2 从 17 降到 16 |
| `npm run build` | PASS |

## 结果

`pages/sales-orders/useSalesOrders.ts` 从 608 行降到 598 行，已退出全仓审计的大文件 findings。

后续如果继续拆，优先拆：

1. 回款弹窗状态与动作。
2. OCR/扫描导入动作。
3. 订单明细 Excel 网格动作。
4. 草稿与离线同步动作。

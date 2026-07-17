# Order Payment Controller 拆分执行记录 2026-04-21

## 本包目标

降低订单控制器维护成本，同时保持回款登记、回款核验、重复提交防护、职责分离和订单详情回读行为不变。

## 改动内容

| 文件 | 职责 |
| --- | --- |
| `backend/src/controllers/order.controller.ts` | 保留订单列表、详情、创建、编辑、状态、导入、发货可用、结案、导出，以及 `recordPayment / verifyPayment` 薄委托入口 |
| `backend/src/controllers/order-payment.controller.ts` | 承接订单回款登记与订单回款核验完整实现 |

## 边界原则

1. 不改路由文件，`order.routes.ts` 仍然调用 `orderController.recordPayment` 和 `orderController.verifyPayment`。
2. 不改接口路径：`POST /api/orders/:id/payment` 和 `POST /api/orders/:id/payment/:paymentId/verify` 保持不变。
3. 不改响应结构、错误文案、状态码。
4. 不改重复提交 15 秒窗口、不改 same-order row touch 序列化策略。
5. 不改职责分离：订单创建者不能核验自己订单回款。
6. 不改 `CollectionStateService.verifyPaymentRecord()` 对回款、订单 paidAmount/paymentStatus、催收状态的联动。

## 验收证据

| 验收项 | 结果 |
| --- | --- |
| `npm --prefix backend run build` | PASS |
| `npm run lint` | PASS |
| `node scripts\effective-source-mojibake-gate-v1.cjs` | PASS |
| `node scripts\full-codebase-audit-v1.cjs` | WARNING，无 P0；P2 从 14 降到 13 |
| `node scripts\backend-business-chain-audit-v1.cjs` | PASS |
| `node scripts\orders-api-audit-v1.cjs` | PASS |
| `node scripts\concurrency-consistency-audit-v1.cjs` | PASS |
| `node scripts\order-collection-data-scope-audit-v1.cjs` | PASS |
| `node scripts\concurrency-reconcile-deep-audit-v1.cjs` | PASS，findings 0 |
| `npm run verify:phase3` | PASS，13/13 |

## 关键报告

| 报告 | 结果 |
| --- | --- |
| `output/playwright/backend-business-chain-audit-report-v1.json` | `passed` |
| `output/playwright/concurrency-consistency-audit-report-v1.json` | `passed` |
| `output/playwright/orders-api-audit-report-v1.json` | `passed` |
| `output/playwright/order-collection-data-scope-audit-report-v1.json` | `passed` |
| `output/playwright/concurrency-reconcile-deep-audit-report-v1.json` | `passed`，`findingCount=0` |
| `output/audit/phase3-readiness-audit-v1.json` | `passed`，13/13 |

## 结果

`backend/src/controllers/order.controller.ts` 从 793 行降到 555 行，已退出全仓审计大文件 findings。

这包属于“控制器边界拆分”，不是回款规则重写。真正的金额链路仍由原事务、原幂等窗口和原回读服务保证。

## 后续建议

订单控制器后续可以继续拆：

1. `order-status.controller.ts`：订单状态迁移、职责分离、出货信用检查。
2. `order-export.controller.ts`：导出和审计日志。
3. `order-shipping-ready.controller.ts`：可发货订单筛选。
4. `order-mutation.controller.ts`：创建、编辑、结案。

但每一包都必须配套订单 API、回款 API、并发对账和阶段 3 总闸门。

# Shipping Controller 拆分执行记录 2026-04-21

## 本包目标

- 将 `backend/src/controllers/shipping.controller.ts` 从巨型控制器拆成更清晰的发货主入口、发货辅助层、分批签收入口。
- 不改变路由、不改变请求/响应结构、不改变数据库表结构、不删除历史文件和用户数据。
- 按“防幻觉验收”要求，必须同时通过静态检查、乱码闸门、发货 API、发货浏览器探针和 Phase3 总验收。

## 拆分结果

- `backend/src/controllers/shipping.controller.ts`
  - 保留发货列表、新建发货单、上传签收凭证、签收事件查询、状态推进等 HTTP 入口。
  - `createReceiptEvent` 改为稳定转发入口，避免主控制器继续膨胀。

- `backend/src/controllers/shipping-controller.helpers.ts`
  - 承接客户显示名展平、发货状态流转表、签收批次汇总、数据范围过滤、读写权限判断、发货详情回读、订单发货状态同步。
  - 这些函数属于跨方法复用的“辅助层”，后续可以单独补单元测试。

- `backend/src/controllers/shipping-receipt-event.controller.ts`
  - 承接分批签收事务：数量校验、超签阻止、签收文件保存、签收批次写入、差异案件生成、发货状态推进、订单状态同步、审计日志写入。
  - 保持原业务逻辑不变，只移动结构边界。

## 结构收益

- `shipping.controller.ts` 从 875 行降到 456 行。
- 全仓审计 oversized P2 从 13 项降到 12 项。
- 发货链路的定位边界更清楚：
  - 主入口问题：看 `shipping.controller.ts`
  - 权限/汇总/状态同步问题：看 `shipping-controller.helpers.ts`
  - 分批签收事务问题：看 `shipping-receipt-event.controller.ts`

## 验收证据

- `npm --prefix backend run build`：通过。
- `npm run lint`：通过。
- `node scripts/effective-source-mojibake-gate-v1.cjs`：通过，扫描 418 个有效源码文件，未发现源码乱码。
- `node scripts/shipping-api-audit-v1.cjs`：通过。
  - 报告：`output/playwright/shipping-api-audit-report-v1.json`
- `node scripts/shipping-browser-audit-v1.cjs`：通过。
  - 报告：`output/playwright/shipping-audit-report-v1.json`
- `node scripts/full-codebase-audit-v1.cjs`：warning，当前剩余 `P1=1 / P2=12`。
  - 报告：`output/audit/full-codebase-audit-v1.json`
- `npm run verify:phase3`：通过 13/13。
  - 报告：`output/audit/phase3-readiness-audit-v1.json`

## 反思与剩余风险

- 本包没有改动业务判断，只做结构拆分；因此优先级正确，没有偏向 UI 或新功能。
- 这不是“完美完成”，只是完成发货控制器治理。剩余 P2 仍包括客户、采购、生产、仓储、货抵、审计脚本和翻译大文件。
- 下一包建议继续处理 `customer.controller.ts` 或 `receipt-discrepancy.service.ts`，因为它们同样影响真实业务闭环和后续维护成本。

# Customer Controller 拆分执行记录 2026-04-21

## 本包目标

- 将 `backend/src/controllers/customer.controller.ts` 从巨型 CRM 控制器收束为核心读写入口。
- 不改变客户主数据规则，不改变多名、多址、多联系人，不改变公海、内池、私海池流转规则。
- 优先拆出低耦合但高维护成本的导入导出、关联记录、客户池治理入口。

## 拆分结果

- `backend/src/controllers/customer.controller.ts`
  - 保留客户列表、统计、详情、新建、更新、删除等核心入口。
  - 导入导出、关联记录、客户池入口改为薄代理。

- `backend/src/controllers/customer/customer-request.helpers.ts`
  - 承接请求体解析、可选字符串、可空字符串、客户池状态兜底。

- `backend/src/controllers/customer/customer-io.controller.ts`
  - 承接客户批量导入与导出。
  - 保留导入权限、销售负责人校验、地址联系人持久化、导入审计日志。

- `backend/src/controllers/customer/customer-relations.controller.ts`
  - 承接客户订单、售后、资产流转关联查询。
  - 保留敏感资产关系的角色权限判断。

- `backend/src/controllers/customer/customer-pool.controller.ts`
  - 承接公海、内池、私海池调整和池归属历史。
  - 保留必须填写变更原因、私海必须指定负责人、负责人可用性校验、审计日志。

## 结构收益

- `customer.controller.ts` 从 1050 行降到 585 行。
- 全仓审计 oversized P2 从 12 项降到 11 项。
- 客户模块排查边界更清楚：
  - 主数据基础 CRUD：看 `customer.controller.ts`
  - 导入导出：看 `customer-io.controller.ts`
  - 订单/售后/资产关联：看 `customer-relations.controller.ts`
  - 公海/内池/私海流转：看 `customer-pool.controller.ts`

## 验收证据

- `npm --prefix backend run build`：通过。
- `npm run lint`：通过。
- `node scripts/effective-source-mojibake-gate-v1.cjs`：通过，扫描 422 个有效源码文件，未发现源码乱码。
- `node scripts/customer-data-scope-audit-v1.cjs`：通过。
  - 报告：`output/playwright/customer-data-scope-audit-report-v1.json`
- `node scripts/customer-ops-permission-scope-audit-v1.cjs`：通过。
  - 报告：`output/playwright/customer-ops-permission-scope-audit-report-v1.json`
- `npx tsx scripts/customer-name-regression.ts`：通过。
- `node scripts/full-codebase-audit-v1.cjs`：warning，当前剩余 `P1=1 / P2=11`。
  - 报告：`output/audit/full-codebase-audit-v1.json`
- `npm run verify:phase3`：通过 13/13。
  - 报告：`output/audit/phase3-readiness-audit-v1.json`

## 反思与剩余风险

- 本包没有重写客户主数据业务规则，方向没有偏离“本地稳定两个月 + 服务器可迁移”。
- 客户模块仍可继续优化，但不建议在同一包继续重写新建/更新核心事务，避免一次性触碰过多核心数据写入。
- 下一包优先建议处理 `receipt-discrepancy.service.ts` 或 `barter.service.ts`，因为它们直接影响发货差异、货抵支付和财务/库存闭环。

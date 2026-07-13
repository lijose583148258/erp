# Receipt Discrepancy Service 拆分执行记录 2026-04-21

## 本包目标

- 将 `backend/src/services/receipt-discrepancy.service.ts` 从巨型差异服务拆成类型、规则、行映射和业务方法四层。
- 不改变容差规则、不改变短签/异常签收、不改变 RMA 动作、不改变采购与发货差异闭环。
- 保留 `ReceiptDiscrepancyService` 对外入口，避免影响既有 controller 和采购/发货服务。

## 拆分结果

- `backend/src/services/receipt-discrepancy.service.ts`
  - 保留业务方法：创建差异案件、查询/创建容差规则、查询/创建差异动作、查询/结案差异案件。
  - 对外继续 re-export `ReceiptDiscrepancyStatus`，兼容旧导入。

- `backend/src/services/receipt-discrepancy.types.ts`
  - 承接差异来源、状态、模块、对手方、差异类型、容差动作、差异动作、案件、规则和输入结构。

- `backend/src/services/receipt-discrepancy.policy.ts`
  - 承接合法枚举集合、默认容差决策、输入校验、枚举归一化、默认质检判断、自动状态、默认建议动作。

- `backend/src/services/receipt-discrepancy.rows.ts`
  - 承接 SQL select 片段和数据库行到业务对象的归一化映射。

## 结构收益

- `receipt-discrepancy.service.ts` 从 1002 行降到 561 行。
- 全仓审计 oversized P2 从 11 项降到 10 项。
- 以后排查差异问题时边界更清晰：
  - 类型结构：看 `receipt-discrepancy.types.ts`
  - 规则和枚举：看 `receipt-discrepancy.policy.ts`
  - SQL 行映射：看 `receipt-discrepancy.rows.ts`
  - 业务动作：看 `receipt-discrepancy.service.ts`

## 验收证据

- `npm --prefix backend run build`：通过。
- `npm run lint`：通过。
- `node scripts/effective-source-mojibake-gate-v1.cjs`：通过，扫描 425 个有效源码文件，未发现源码乱码。
- `node scripts/full-codebase-audit-v1.cjs`：warning，当前剩余 `P1=1 / P2=10`。
  - 报告：`output/audit/full-codebase-audit-v1.json`
- `node scripts/receipt-discrepancy-api-audit-v1.cjs`：通过。
- `node scripts/receipt-discrepancy-action-api-audit-v1.cjs`：通过。
- `node scripts/receipt-tolerance-api-audit-v1.cjs`：通过。
- `node scripts/partial-receipt-api-audit-v1.cjs`：通过。
- `node scripts/receipt-discrepancy-workbench-static-audit-v1.cjs`：通过。
- `node scripts/receipt-discrepancy-workbench-browser-audit-v1.cjs`：通过。
- `node scripts/procurement-api-audit-v1.cjs`：通过。
- `node scripts/shipping-api-audit-v1.cjs`：通过。
- `npm run verify:phase3`：通过 13/13。

## 反思与剩余风险

- 本包没有改变数据库写入语句、容差判断和状态流转，只做结构抽离，方向符合“先稳后扩”。
- `barter.service.ts` 仍是后端剩余大文件里最值钱的一项，因为货抵支付/换货贸易同时影响金额、库存和结算状态。
- Prisma schema 的 P1 仍需单独研究多文件 schema 支持和迁移风险，不能为了清单好看直接拆。

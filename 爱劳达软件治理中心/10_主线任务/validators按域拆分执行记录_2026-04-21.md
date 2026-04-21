# Validators 按域拆分执行记录 2026-04-21

## 本包目标

降低后端校验层维护成本，不改变任何接口路径、控制器导入方式和业务校验行为。

原问题：

1. `backend/src/validators/index.ts` 同时承载通用参数、订单、物流、采购、货抵、库存、合同等多个业务域。
2. 后续新增字段时容易直接堆到 `index.ts`，形成“校验大桶”，排查接口问题时定位成本高。
3. 全仓审计将该文件列为 P2 大文件维护风险。

## 拆分结果

| 文件 | 职责 |
| --- | --- |
| `backend/src/validators/index.ts` | 只做 barrel export，保持 `import ... from '../validators'` 不变 |
| `backend/src/validators/core.ts` | 通用 query/id/status、汇率转换、refresh token、合同追加项 |
| `backend/src/validators/logistics.ts` | 发货、签收上传、签收事件、收货差异、容差规则、RMA |
| `backend/src/validators/orders.ts` | 销售订单、回款、催收承诺、争议、客户/订单 hold |
| `backend/src/validators/inventory.ts` | 资产交易、产品批次、旧木材接口兼容断开标记 |
| `backend/src/validators/procurement.ts` | 供应商、合同、采购订单、采购收货 |
| `backend/src/validators/barter.ts` | 货抵支付/换货贸易、协议、分批抵扣、过账、冲销 |

## 边界原则

1. 控制器和路由仍统一从 `../validators` 导入，避免一次拆分造成大范围调用改动。
2. 本包只迁移 schema 定义位置，不改字段规则、不改错误文案、不改 `.strict()` / `.passthrough()` 语义。
3. 业务域之间允许先保留少量私有 enum 重复，优先保证行为不变；后续如要抽公共 enum，必须单独验收。
4. 旧木材相关 schema 仍保留在 `inventory.ts`，但保持 `LEGACY DISCONNECTED` 标记，避免重新接入主链路。
5. 后续新增校验必须先判断业务域，不允许继续把新 schema 直接写回 `index.ts`。

## 本包证据

| 验收项 | 结果 |
| --- | --- |
| `npm --prefix backend run build` | PASS |
| `npm run lint` | PASS |
| `node scripts\effective-source-mojibake-gate-v1.cjs` | PASS |
| `node scripts\full-codebase-audit-v1.cjs` | WARNING，无 P0；`validators/index.ts` 已不在大文件 findings |
| `npm run verify:phase3` | PASS，13/13 |

## 反思

这次拆分是正确方向，但不是“完成全部架构治理”。它只解决校验层大桶问题。剩余更高价值的大文件仍集中在：

1. `backend/src/controllers/customer.controller.ts`
2. `backend/src/controllers/shipping.controller.ts`
3. `backend/src/controllers/order.controller.ts`
4. `backend/src/services/barter.service.ts`
5. `backend/src/services/receipt-discrepancy.service.ts`
6. `pages/ProductionWorkspaceV2.tsx`
7. `pages/Procurement.tsx`
8. `pages/WarehouseWorkspace.tsx`

下一步应继续按“低风险结构拆分优先、业务行为不变、每包都有验收证据”的方式推进。

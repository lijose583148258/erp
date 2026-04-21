# Stock Movement 服务减重执行记录 2026-04-21

## 本包目标

降低仓储/生产/采购共用库存服务的维护风险，同时不改变任何库存扣减、幂等、成本台账或回读行为。

## 改动内容

| 文件 | 职责 |
| --- | --- |
| `backend/src/services/stock-movement.service.ts` | 保留库存过账主流程、库存余额更新、移动记录、成本台账联动 |
| `backend/src/services/stock-movement.types.ts` | 承接库存来源、过账输入、移动行、回读结果等类型 |
| `backend/src/services/stock-movement.policy.ts` | 承接幂等来源、需要同步产品批次的来源、默认批次保质期 |

## 边界原则

1. 不改 `StockMovementService.postStockEntry()` 和 `listRecentEntries()` 的外部调用方式。
2. 原服务继续 re-export 类型，避免调用方导入路径断裂。
3. 不改 SQL、不改事务、不改库存不足判断、不改成本台账写入条件。
4. 策略常量先独立，后续若继续拆库存余额更新、批次同步、移动行记录，必须单独验收。

## 验收证据

| 验收项 | 结果 |
| --- | --- |
| `npm --prefix backend run build` | PASS |
| `npm run lint` | PASS |
| `node scripts\effective-source-mojibake-gate-v1.cjs` | PASS |
| `node scripts\full-codebase-audit-v1.cjs` | WARNING，无 P0；P2 从 18 降到 17 |
| `npm run verify:phase3` | PASS，13/13 |

## 结果

`backend/src/services/stock-movement.service.ts` 从 638 行级别降到 592 行，已退出全仓审计的大文件 findings。

这包是“结构减重”，不是业务逻辑重写。它的价值在于让库存服务后续更容易继续拆成：

1. 库存余额更新器。
2. 产品批次同步器。
3. 库存移动记录器。
4. 库存回读 mapper。
5. 成本台账联动适配器。

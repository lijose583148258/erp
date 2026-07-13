# Production Browser Audit 脚本减重执行记录 2026-04-21

## 本包目标

降低生产 BOM 浏览器验收脚本维护成本，同时保留化工 BOM 10 行原料、保密代号、少耗用阻断、完工入库回读的真实浏览器链路。

## 改动内容

| 文件 | 职责 |
| --- | --- |
| `scripts/production-browser-audit-v1.cjs` | 保留浏览器动作、API 回读、少耗用阻断、完工验证、截图证据 |
| `scripts/lib/production-browser-audit-fixtures.cjs` | 承接中文标签字典、乱码禁用码点、步骤超时、10 行化工 BOM 测试数据 |

## 边界原则

1. 不改生产审计步骤顺序。
2. 不改 BOM 数据内容：仍为 10 行原料，其中 7 行可只填保密代号。
3. 不改少耗用阻断断言。
4. 不改完工后批次回读断言。
5. 不改入口，仍然执行 `node scripts\production-browser-audit-v1.cjs`。

## 验收证据

| 验收项 | 结果 |
| --- | --- |
| `node --check scripts\production-browser-audit-v1.cjs` | PASS |
| `node --check scripts\lib\production-browser-audit-fixtures.cjs` | PASS |
| `npm run lint` | PASS |
| `node scripts\effective-source-mojibake-gate-v1.cjs` | PASS |
| `node scripts\full-codebase-audit-v1.cjs` | WARNING，无 P0；P2 从 15 降到 14 |
| `node scripts\production-browser-audit-v1.cjs` | PASS |

## 浏览器实测证据

最新报告：

`output/playwright/production-browser-audit-report-v1.json`

关键结果：

| 字段 | 值 |
| --- | --- |
| `status` | `passed` |
| `appUrl` | `http://127.0.0.1:5001/` |
| `testData.items.length` | `10` |
| 保密代号行 | `7` |
| `incompleteCompletionBlocked.matchedText` | `BOM 原料` |
| `completedBatch.stockQuantity` | `9.8` |
| `completedBatch.status` | `healthy` |
| `failedSteps` | `[]` |

## 结果

`scripts/production-browser-audit-v1.cjs` 从 633 行降到 526 行，已退出全仓审计大文件 findings。

这包证明的是：审计脚本结构变清楚了，并且浏览器级生产主链路仍然能真实跑通。它不代表生产模块全部场景已经完成，后续还要继续拆页面和服务层大文件。

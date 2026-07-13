# Shipping Browser Audit 脚本减重执行记录 2026-04-21

## 本包目标

降低发货浏览器验收脚本维护成本，同时保留原有浏览器级人工流审计能力。

## 改动内容

| 文件 | 职责 |
| --- | --- |
| `scripts/shipping-browser-audit-v1.cjs` | 保留登录、建客户、建订单、种库存、发货、OCR、出库、签收上传、回读验证流程 |
| `scripts/lib/shipping-browser-audit-fixtures.cjs` | 承接测试数据生成、必需页面文案、乱码标记、步骤超时配置 |

## 边界原则

1. 不改发货浏览器审计流程顺序。
2. 不改数据写入和回读断言。
3. 不改乱码检测语义，仍保留 `undefined`、替换符和历史坏码标记。
4. 不改入口，仍然执行 `node scripts\shipping-browser-audit-v1.cjs`。

## 验收证据

| 验收项 | 结果 |
| --- | --- |
| `node --check scripts\shipping-browser-audit-v1.cjs` | PASS |
| `node --check scripts\lib\shipping-browser-audit-fixtures.cjs` | PASS |
| `npm run lint` | PASS |
| `node scripts\effective-source-mojibake-gate-v1.cjs` | PASS |
| `node scripts\full-codebase-audit-v1.cjs` | WARNING，无 P0；P2 从 16 降到 15 |
| `node scripts\shipping-browser-audit-v1.cjs` | PASS |

## 浏览器实测证据

最新报告：

`output/playwright/shipping-audit-report-v1.json`

关键结果：

| 字段 | 值 |
| --- | --- |
| `status` | `passed` |
| `appUrl` | `http://127.0.0.1:5001/` |
| `order.status` | `delivered` |
| `linkedShipment.status` | `delivered` |
| `issueEvidence.entryCount` | `1` |
| `issueEvidence.remainingQuantity` | `12` |
| `failedSteps` | `[]` |

## 结果

`scripts/shipping-browser-audit-v1.cjs` 从 603 行降到 583 行，已退出全仓审计大文件 findings。

这包没有证明“所有发货场景都完美”，但证明本轮改动没有破坏发货浏览器验收脚本，并且核心链路完成了真实写入、出库、签收和回读。

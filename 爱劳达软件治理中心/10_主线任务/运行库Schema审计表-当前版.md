# 运行库 Schema 审计表

更新时间：2026-04-13

## 运行时基线

- 运行库：`C:\Users\ADMINI~1\AppData\Local\Temp\AilaoDaRuntime\stable.db`
- 后端入口：`http://127.0.0.1:5001`
- 审计命令：`node .\dist\database\manage-db.cli.js audit`
- 修复命令：`node .\dist\database\manage-db.cli.js repair`

## 本轮审计结果

- `tableCount = 30`
- `issueCount = 0`
- 结论：当前 runtime DB 与 `backend/prisma/schema.prisma` 已对齐

## 已纳入 repair 的关键对象

- `orders.locked_exchange_rate`
- `orders.base_amount`
- `payment_records.currency`
- `payment_records.exchange_rate`
- `payment_records.base_amount`
- `payment_records.barter_metadata`
- `barter_settlements`
- `barter_items`
- `barter_valuation_snapshots`
- `barter_offset_postings`
- `barter_reversal_logs`

## 风险说明

- 当前结论只覆盖“运行库结构是否缺表缺列”
- 不代表所有业务逻辑都已经正确
- 后续若 Prisma schema 新增字段，必须先执行 `repair` 再做业务点测

## 后续动作

1. 将 `audit` 结果接入每轮稳定启动后的固定检查
2. 每次新增模型字段时同步扩充 `runtime-schema-repair.ts`
3. 在 A9 压测阶段继续验证 schema 完整但逻辑仍可能漂移的场景

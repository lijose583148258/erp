# ADR 0039：金额精度先统一计算边界，再分阶段迁移持久化类型

- 状态：Accepted（阶段 1 已执行）
- 日期：2026-08-01
- 范围：销售应收、回款、应收调整、货抵估值、采购成本、库存成本

## 背景

当前 Prisma 模型仍有大量金额、数量和汇率字段使用 `Float`。服务层同时存在 `Number.toFixed(2)`、`Math.round(value * 100)` 和普通 JavaScript 加总，舍入规则分散且缺少专门财务精度测试。

一次性把全部字段改为 Prisma `Decimal` 会同时改变：

- PostgreSQL 列类型和索引；
- SQLite 回滚库与导入快照；
- Prisma 返回类型；
- JSON/API 数字或字符串契约；
- 乐观并发条件中的等值比较；
- 前端、导入导出和报表格式。

因此禁止用一次全库替换制造“已经财务级”的假象。

## 决策

### 阶段 1：统一计算边界

后端金额计算统一经过 `backend/src/utils/money.ts`：

- 使用 Prisma 自带 `Decimal` 进行加、减、乘、比较；
- 金额统一采用两位小数、`ROUND_HALF_UP`；
- 非有限数值立即拒绝；
- 当前 API 仍返回 `number`，避免本阶段破坏客户端契约；
- 首批接入应收余额/状态、应收调整和货抵估值。

必须覆盖 `0.1 + 0.2`、`1.005`、多笔加总、扣减归零、双方货抵差额和两位小数比较。

### 阶段 2：数据库扩展迁移

持久化迁移按业务链分批，不按文件批量替换。首批候选为：

1. 订单 `finalAmount / paidAmount / receivableAdjustmentAmount`；
2. 回款 `amount / exchangeRate / baseAmount`；
3. 应收调整 `amount / exchangeRate / baseAmount`。

每批必须采用 expand → backfill → 双读核对 → 切换写入 → contract，验证 PostgreSQL 精度、SQLite 最终备份回滚、序列、外键、并发核销和 API 回读后再进入下一批。

### 阶段 3：数量、汇率和成本

- 金额建议 `Decimal(18, 2)`；
- 数量建议 `Decimal(18, 6)`；
- 汇率建议 `Decimal(18, 8)`；
- 成本单价需按实际核算精度单独决策，不沿用金额两位小数。

## 非目标

- 本阶段不宣称数据库已完成 Decimal 化；
- 不把数量、百分比、温度和质量检测值错误套用金额两位小数；
- 不改变现有 API 的 JSON 数字类型；
- 不通过前端格式化掩盖存储精度问题。

## 验收门禁

- 精度工具及首批业务计算测试通过；
- 后端 strict build 和完整 Jest 回归通过；
- 应收、回款、货抵并发与冲正不变量继续通过；
- 后续数据库迁移必须有逐字段前后指纹和真实 PostgreSQL/SQLite 回滚证据。

# ADR 0039：金额精度先统一计算边界，再分阶段迁移持久化类型

- 状态：Accepted（阶段 1、阶段 2A 已执行）
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

#### 阶段 2A 已执行：首批影子列

首批已经以**纯加法迁移**落地以下影子列，正式 API 读取仍保持旧字段：

- `orders`: `final_amount_decimal / paid_amount_decimal / receivable_adjustment_amount_decimal`；
- `payment_records`: `amount_decimal / exchange_rate_decimal / base_amount_decimal`；
- `receivable_adjustments`: `amount_decimal / exchange_rate_decimal / base_amount_decimal`。

SQLite 运行时修复链负责：

- 幂等增加 `NUMERIC(18,2)` 与 `NUMERIC(18,8)` 影子列；
- 对历史数据按字段精度回填；
- 使用插入、更新触发器同步旧写路径；
- 启动后运行逐字段空值、差异行数和汇总值核对。

PostgreSQL 版本化迁移 `202608010004_receivables-decimal-shadow` 负责：

- 在单个迁移事务中增加、回填影子列；
- 使用 `BEFORE INSERT OR UPDATE` 触发器覆盖旧版本应用写入；
- 回填完成后将影子列设置为 `NOT NULL`；
- 保留全部旧列，不执行删除或原地类型替换。

本轮本地发布门禁的最终 SQLite 证据验证了 3 张表、9 个字段、6,676 行，空影子值和精度差异均为 0；强制回滚写探针同时验证了插入与更新触发器，未留下审计业务行。该结果**不替代真实 PostgreSQL 证据**。

#### 阶段 2B 尚未执行：切读与收缩

只有满足以下条件后，才允许把应用读取切到 Decimal：

1. 170,911 行 PostgreSQL 认证环境的 9 字段差异为 0；
2. 新旧应用并行写入观察窗内差异持续为 0；
3. 核销、冲正、货抵、应收调整和报表 API 的新旧读结果逐字段一致；
4. PostgreSQL 备份恢复和 SQLite 最终备份回滚后仍可读写；
5. Prisma Decimal 返回值经过明确 API 序列化，客户端数字契约没有被暗中改变。

旧列删除属于单独的 contract 迁移；不得和切读放在同一发布窗口。

### 阶段 3：数量、汇率和成本

- 金额建议 `Decimal(18, 2)`；
- 数量建议 `Decimal(18, 6)`；
- 汇率建议 `Decimal(18, 8)`；
- 成本单价需按实际核算精度单独决策，不沿用金额两位小数。

## 非目标

- 本阶段不宣称数据库已完成 Decimal 化；
- 阶段 2A 不宣称应用已经从 Decimal 读取；
- 不把数量、百分比、温度和质量检测值错误套用金额两位小数；
- 不改变现有 API 的 JSON 数字类型；
- 不通过前端格式化掩盖存储精度问题。

## 验收门禁

- 精度工具及首批业务计算测试通过；
- 后端 strict build 和完整 Jest 回归通过；
- 应收、回款、货抵并发与冲正不变量继续通过；
- 后续数据库迁移必须有逐字段前后指纹和真实 PostgreSQL/SQLite 回滚证据。

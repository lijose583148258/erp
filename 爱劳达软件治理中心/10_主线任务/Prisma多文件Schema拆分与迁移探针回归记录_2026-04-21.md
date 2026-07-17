# Prisma 多文件 Schema 拆分与迁移探针回归记录 2026-04-21

## 1. 背景

本轮处理的是阶段 3 治理包里剩余的 P1 问题：`backend/prisma/schema.prisma` 单文件过大，已经影响后续维护、迁移判断和人工审计。

此前全仓审计把它列为 P1，并不是因为运行立即坏掉，而是因为后续继续补表、补字段、补关系时，所有业务域都堆在同一个 schema 文件里，维护者很难判断某个字段属于 CRM、采购、仓储、生产还是货抵支付。

## 2. 调研结论

当前项目使用 Prisma 5.22.0。官方多文件 Prisma Schema 在 Prisma 5.15 起通过 `prismaSchemaFolder` preview feature 可用，在 Prisma 6.7 后进入 GA。因为当前项目没有升级 Prisma，所以本轮采用保守方案：

- 保留 Prisma 5.22.0。
- 在 `generator client` 中显式启用 `previewFeatures = ["prismaSchemaFolder"]`。
- 把 CLI 默认 schema 指向 `prisma` 目录，而不是只指向单个 `schema.prisma` 文件。
- 先在 `output/prisma-schema-split-probe` 做隔离探针，再迁移正式目录。

参考资料：

- [Prisma 官方博客：Organize your Prisma Schema into multiple files](https://www.prisma.io/blog/organize-your-prisma-schema-with-multi-file-support)
- [Prisma 官方文档：Prisma Schema Location and Configuration](https://www.prisma.io/docs/v6/orm/prisma-schema/overview/location)
- [Prisma 官方 Preview feature 记录：prismaSchemaFolder 5.15.0 preview / 6.7.0 GA](https://www.prisma.io/docs/orm/reference/preview-features/client-preview-features)

## 3. 实际拆分

`backend/prisma/schema.prisma` 现在只保留：

- `generator client`
- `datasource db`
- schema 入口说明注释

业务模型拆到 `backend/prisma/models`：

| 文件 | 负责范围 |
| --- | --- |
| `auth-team.prisma` | 用户、角色、权限、团队和审计基础 |
| `crm-sales.prisma` | 客户主数据、订单、回款、CRM 关系 |
| `procurement.prisma` | 供应商、采购单、采购收货 |
| `logistics-service.prisma` | 发货、OCR、签收、服务单 |
| `inventory-warehouse.prisma` | 仓库、库位、库存、库存事务 |
| `production.prisma` | 化工 BOM、工单、质检、成本台账 |
| `barter-adjustment.prisma` | 货抵支付、换货贸易、差异调整 |

拆分后当前行数：

| 文件 | 行数 |
| --- | ---: |
| `backend/prisma/schema.prisma` | 13 |
| `backend/prisma/models/auth-team.prisma` | 110 |
| `backend/prisma/models/barter-adjustment.prisma` | 227 |
| `backend/prisma/models/crm-sales.prisma` | 275 |
| `backend/prisma/models/inventory-warehouse.prisma` | 206 |
| `backend/prisma/models/logistics-service.prisma` | 193 |
| `backend/prisma/models/procurement.prisma` | 63 |
| `backend/prisma/models/production.prisma` | 123 |

## 4. 配套修正

为避免“拆了 schema，但 CLI 仍只读旧入口”的假绿，本轮同步修正：

- `backend/package.json`
  - `migrate`: `prisma migrate dev --schema prisma`
  - `prisma:validate`: `prisma validate --schema prisma`
  - `prisma:generate`: `prisma generate --schema prisma`
  - 增加顶层 `prisma.schema = "prisma"`
- `scripts/db-migration-probe.cjs`
  - 从复制单个 `schema.prisma` 改为复制整个 schema 目录。
  - PostgreSQL 迁移探针只改复制目录里的 datasource provider。
  - Windows 下避开 `fs.cpSync` 对复杂目录偶发失败，改为白名单复制 `.prisma` 文件。

## 5. 验收证据

本轮验收全部按 5 分钟上限执行：

| 验收项 | 结果 |
| --- | --- |
| `prisma validate` | PASS |
| `npm run prisma:generate` | PASS |
| Prisma bare `generate` | PASS |
| `backend npm run build` | PASS |
| 根目录 `npm run build` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `effective-source-mojibake-gate-v1.cjs` | PASS，扫描 460 个有效源码文件 |
| `deployment-migration-readiness-audit-v1.cjs` | PASS |
| `db-migration-probe.cjs` | PASS |
| `full-codebase-audit-v1.cjs` | PASS，`findingCounts = {}`，`oversizedFiles = 0` |
| `scripts/check-runtime.ps1` | PASS，稳定入口 `http://127.0.0.1:5001/` |
| `npm run verify:phase3` | PASS，13/13 |

## 6. 风险判断

本轮没有删除旧数据、历史归档、报告和用户文件。

需要继续诚实标记的风险：

- 当前仍是 Prisma 5.22.0，multi-file schema 依赖 preview flag；这不是坏事，但后续升级 Prisma 到 6.7+ 后可以消除 preview 心理负担。
- `db-migration-probe.cjs` 只能证明 schema 语法可以切 PostgreSQL provider，不等于真实线上数据已经迁移成功。
- 两个月稳定运行不能靠一次 `verify:phase3` 宣布完成，仍必须靠每日稳定台账、备份恢复演练和真实业务回读累计。

## 7. 本轮结论

这一包是正确方向：它没有继续往单个大文件里堆补丁，而是把数据库模型按业务域拆开，并把 Prisma CLI、迁移探针、构建、运行、阶段 3 验收一起压过。

后续如果再补 CRM、采购、仓储、生产、货抵字段，必须优先进入对应的 `backend/prisma/models/*.prisma` 文件，不能再把所有模型塞回主入口。

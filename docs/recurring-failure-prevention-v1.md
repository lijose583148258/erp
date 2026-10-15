# 反复失败的根因与预防方案（2026-10-02）

## 2026-10-15：采购包云端回归的两个独立原因

修复后[云运行 38671840484](https://github.com/lijose583148258/erp/actions/runs/38671840484) 已核对累计 67/67，采购人工链和回款恢复均通过；新增的独立脚本失败/真实主入口失败正反例在 PostgreSQL 浏览器运行中实际执行。以下失败记录仍保留，用于说明根因而非当前状态。

[云运行 38665653533](https://github.com/lijose583148258/erp/actions/runs/38665653533) 的新采购/QC/应付链通过，但累计 62/67，不予交付。失败原件和时间窗保留，不能称为 32/37 完整通过。

1. **真实启动遮罩缺陷**：应用重启后的 `/app-shell.js` 出现 `net::ERR_NETWORK_CHANGED`。React 已显示业务错误恢复入口，但遮罩只靠该独立脚本移除，导致入口被永久覆盖。修复由已有根 `ErrorBoundary` 提交时结束启动；旧脚本仅在根已挂载时作兼容处理，PWA 缓存版本同步升级。不在测试中隐藏 DOM，不延长超时。
   - 必跑正反例：仅阻断独立脚本时应用仍能点击输入；仅阻断真实主入口模块时根保持未挂载、启动反馈不被假移除。
   - 原有 SalesOrders/AI chunk 故障、一次显式恢复、未知回款请求的原身份、独立双财务回读仍全部保留。
2. **旧人工流程假未就绪**：采购作者已在订单页，路由检测却要求供应商页专属文案；同 hash 导航不会重新挂载。公共壳与导航就绪单独判断，供应商专属验证保留在明确进入供应商页后。独立审批后作者必须重载并取得该 PO 的新 GET，验证批准状态和版本，再发运。
   - 原人工采购链加入本地累计执行，不再只能等企业云暴露。
   - 旧脚本入口统一 URL 尾斜杠；数量错误用例先提供实际供应商批号，避免两个错误字段相互遮挡。不降低数量/批次、审计、QC、库存成本断言。

PR 测试合并 SHA `d600ea55` 与推送 SHA `d6410c9` 的 Git tree 同为 `a0a21f87dcb9b6b83ffac7e8b26510d2a82c9d40`，不是混版。后续必须同样区分 Actions 的 head SHA、实际 checkout SHA 与源码树，不仅看运行标题。

## 已证实的问题，不把不同错误混为一谈

| 现象 | 证据与归因 | 已做 / 待做 |
|---|---|---|
| 本地通过、云端迁移失败 | `11b53aa` 云 #36976237640：`db push` 先创建 `event_key`，版本迁移随后再次添加，SQLSTATE 42701。SQLite 累计回归没有覆盖此 PostgreSQL 执行顺序。 | 已补两条真实 PostgreSQL 路径及行为约束测试；云端前置执行同一脚本。 |
| 只补 `IF NOT EXISTS` 可能假通过 | Prisma 创建的表未包含此次手写 SQL CHECK。跳过建表还会跳过内联 CHECK。 | 本次迁移显式补装 CHECK；测试确实尝试非法值，核对 23514，而不是仅检查 SQL 文本。 |
| 核销后重复通知 | `ec34207` 复现：已核销入口重放两次产生两个 UUID；属于提交副作用未持久化。 | `11b53aa` 已加入事务审计和 outbox，网络重投保留 UUID；完整事件验收仍未晋级。 |
| PostgreSQL 切换后只读失败 | #36861717070：P1017；不是核销幂等问题。 | `ec34207` 只对纯读取做有界重连重试，#36954322546 52/52。不能把同样重试套到有歧义的写操作。 |
| GitHub API 证书错误 | 本机 Node 默认 CA 下 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`；系统 CA 启动参数成功。 | 使用 `--use-system-ca`，不关闭证书验证，不重复创建云任务。 |
| 验证进程直接退出 | 本机 Node 24.13.0 递归 `fs.cpSync` 最小复现只输出“复制前”，未到达“复制后”；逐文件读写后同一 PostgreSQL 测试可运行。 | 新脚本不用该递归复制路径；这是已定位的触发点，不足以断定 Node、操作系统或安全软件的最终根因。 |

## 官方调研结论与本项目取舍

1. **区分 schema 同步与版本迁移。** Prisma 说明 `db push` 不维护迁移历史，偏向原型开发；重要环境应使用可追踪的迁移。当前项目的生产启动使用自有带校验和的 SQL migrator，云端导入演练另外使用 `db push` 引导空库。此次直接原因是这两条路径未被同测，不是生产启动偷偷使用了 db push。[Prisma 原型与迁移](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/prototyping-your-schema)
2. **同名对象存在不代表结构正确。** PostgreSQL 明确指出 `CREATE TABLE IF NOT EXISTS` 不保证已有对象等同于声明。因此必须检查唯一键、外键、CHECK 和旧数据保存，不能只加入 IF NOT EXISTS 就宣布解决。[PostgreSQL 17 CREATE TABLE](https://www.postgresql.org/docs/17/sql-createtable.html)
3. **统一迁移基线是长期方案。** 后续独立包应建立经验证的不可变 PostgreSQL 基线，使新库和旧库都走“基线 + 版本迁移”。已有库需比对结构后接入历史，不得把全部迁移盲目标为已执行，也不删除迁移账本。[Prisma baselining](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining)
4. **TLS 故障修可信证书链，不关校验。** Node 支持读取系统 CA；本机已验证该路径。调研不授权更换 Node/Prisma 大版本，本次仍使用项目现有依赖。[Node 系统 CA](https://nodejs.org/download/release/v24.20.0/docs/api/cli.html#--use-system-ca)

文档中的 Prisma 原则适用于本问题，但本项目实际依赖为 5.22.0；不照抄新主版本命令、不顺带升级 ORM。

## 每次复发的处理规则

1. 给失败归类：产品逻辑 / 迁移与环境 / 测试实现 / 外部阻断。记录提交、环境、阶段、SQLSTATE 或退出码，以及原始证据路径。
2. 同一错误没有新信息时不重复重跑整套云。先最小复现；两次相同结果后必须改变诊断假设或记录外部阻断。
3. 先留“修复前失败”的测试，再修根因，再证明“修复后通过”。复现脚本进入仓库并接入门禁，不留在一次性聊天命令里。
4. 同一个版本在本地与云端跑同一验证入口；至少覆盖新库、旧库、重复执行、旧记录不变、非法状态被数据库拒绝。
5. **每个包都重放前序全部已通过链条。** 当前本地累计 29 项、云端 52 项只增不减；完整 37 项目录另行判定。
6. 业务用例失败：继续运行独立后续用例，最后统一失败。基础迁移失败：依赖它的业务用例标未执行/阻断，不在坏 schema 上强跑；汇总仍失败，不能把 skipped 当通过。[GitHub Actions 失败控制](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
7. 交接包含运行编号、源码指纹、待核对证据和临时进程清理状态，避免下一轮从头猜测。生成证据和临时凭证不入 Git。

## 本次双路径真实验证

- 修复前：`output/payment-event-migration/0561be06281c/report.json`。新库先 db push 再迁移失败；旧结构首次升级后再次执行同样失败，均为 42701。
- 修复后初验：`output/payment-event-migration/141fccbb41ba/report.json`。PostgreSQL 17.7，两条路径均通过；检查重复事件/投递为 23505、非法状态/渠道/次数为 23514、删除被引用事件为 23503；旧 payload 与时间未变，不补造历史事件键。
- 最终同源复核：`output/payment-event-migration/4139d426fc3c/report.json`，两条路径再次通过。新 schema 全部清理；临时 PostgreSQL 集群已关闭，见 `output/review/payment-event/pg-fixture-cleanup.json`。跨轮临时进程消失导致的一次 ECONNREFUSED 记录保留为环境阻断，不算迁移逻辑回归；最终采用单次命令内启动→测试→关闭。
- 本次只修正尚未发布、在已知云运行中事务回滚的新迁移 `202610020001`；不修改更早已应用迁移。migrator 的校验和不放宽，发现已应用旧校验和时应停止并单独处理，不能伪造账本。
- 新探针已接入云端建库前置检查；结果同步输出到 `output/audit/payment-event-migration-v1.json`，由现有 always 证据归档保留。
- 统一全量 PostgreSQL 基线、工具环境统一启动器及真实财务浏览器事件恢复仍是后续事项，不在此文中冒充已实现。

## 本次修复最终门禁

- 后端完整 92 套 / 551 项、源码契约 125 项通过；迁移账本、云拓扑、编码与密钥门禁通过。
- 最终源码指纹 `20d12c7cb2fafe3891b05c8bd2752f4b4eaa8de757109bc91e651430f7966b9b`，本地累计回归 `output/round2/1790933639056-c1338b1b/cumulative-regression.json` 为 29/29；逐包前序回放未删减。
- 独立只读复核 `output/review/payment-event/migration-local-verification.json`：SQLite integrity 为 ok、外键无异常、两笔核销各只有一个事件键，实时投递记录已完成；补货计划草稿、独立审批与签收结案截图已人工查看。
- 上述只证明本次修复的本地范围。完整目录仍为 22/37、15 项未完成；新提交的云端 52 项累计回归须另外核实，不继承历史通过。

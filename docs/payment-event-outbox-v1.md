# 回款核销事务事件基础包 v1

## 边界与决策

- 两个现有核销入口保持原来的财务权限、记录范围和订单创建者职责分离；共享 `CollectionStateService.verifyPaymentRecord`。
- 获得 `pending -> verified` 的事务，先做金额/订单/里程碑校验，再同时写 `PAYMENT_VERIFIED` 审计、唯一业务事件及待投递记录。任一失败，全部回滚。
- 复用已有 `BusinessEvent`，不另建第二套业务事件库。可空唯一键 `payment.verified:<paymentId>` 保留旧数据兼容；UUID、发生时间和金额快照在事务内一次生成并持久化。历史已核销记录不补造审计或补发事件。
- 待投递目的地按“事件 + 渠道 + 目的地哈希”唯一；不存 URL、签名密钥或异常原文。Webhook 目的地在提交时确定，密钥发送时从配置解析。移除目的地留下 `DESTINATION_NOT_CONFIGURED`，不把旧事件转投新地址。
- 每 2 秒调度，最多 10 条一批；跨实例通过条件更新领取 30 秒租约。HTTP 发送最多 5 秒，无跨网络数据库事务，不跟随重定向。失败退避，上限 5 分钟；没有“超次数就丢弃”的分支。
- 数据库回执失败保留 sending，租约到期后以原 UUID 重发；旧租约不能覆盖新租约的回执。**业务事件唯一不等于网络 exactly-once**：外部接收方须以事件 ID 去重。
- 站内提示走同一个 outbox，限定 admin/manager/finance；共享 Redis 发布成功才确认。WebSocket 是在线提示，不是离线已读证明。前端在会话内保留最多 512 个 ID 去重，退出登录清空。
- 已取消/冲销等非 pending 状态不再伪装成“已经核销成功”，返回冲突。

## 本地证据（不是全 37 项通过）

### 企业云暴露的迁移回归与修复

`11b53aa` 的 [企业云 #36976237640](https://github.com/lijose583148258/erp/actions/runs/36976237640) **确实失败**：先 `db push` 后版本迁移，`event_key` 重复添加。累计 4 / 52，其余 48 项因应用未启动缺失/跳过；没有生成新的 R2 业务报告，不能沿用前轮结果声称本提交云端通过。

已修正新迁移的引导/旧库双路径兼容性，且不只加 `IF NOT EXISTS`：对 Prisma 预建表单独补装 CHECK。新增真实 PostgreSQL 探针已接入云前置门禁，细节、官方调研与修复前后证据见 `recurring-failure-prevention-v1.md`。生产级验收与原 37 项目录保持不变，新云运行仍需独立验证。

### `11b53aa` 提交前本地证据（保留，不冒充修复后云证据）

- 后端全量：92 suites / 551 tests，通过；构建、前端 TypeScript、源码乱码/密钥治理检查通过。
- 累计源码契约新增 5 项，共 124 项；源码契约只依赖 Node 内置模块，仍可在安装依赖前运行。
- 实际 SQLite / 两个 Prisma 发送器 / 本机 HTTP 接收器：`output/payment-event/1790923979453-25f94c78/report.json`，7 组故障场景通过，integrity_check=ok，foreign_key_check=[]。
- 上述故障包括：事务内事件插入失败；独立进程提交后、发送前退出；8 次重放；双发送器竞争；真实 HTTP 503 后重发；真实接收成功后注入数据库回执失败并恢复过期租约；取消/超额核销拒绝。
- 租约恢复使用受控时钟推进，回执丢失使用数据库调用故障注入。**不冒充真实数据库服务器重启**。
- 源码指纹：`b821c4647fc685ea00a4a002c4f2ffa83d1ebed3c166f943351a45f892910726`。
- 原有双实例 `payment-duplicate-verification` 增加回款中心交叉重放和审计/事件回读。原 37 项目录与 22 项累计基线保持不变，`payment-event-audit-once` 暂不晋级。
- 最终源码前序累计重放：`output/round2/1790923963847-71975713/cumulative-regression.json`，**29 / 29 通过**；完整 R2 **22 / 37、0 失败、15 未完成**，R2 子进程按预期返回 2。采购补货计划三张浏览器截图已人工查看；独立数据库检查 integrity=ok、FK=[]，后台发送器也已将核销提示标为 delivered。复核记录：`output/review/payment-event/local-verification.json`。

## 运维与恢复

在内部数据库管理通道检查，不公开在匿名 readiness 中暴露财务事件：

```sql
SELECT status, channel, COUNT(*) AS deliveries, MIN(created_at) AS oldest
FROM business_event_deliveries
GROUP BY status, channel;

SELECT id, event_id, channel, attempts, next_attempt_at, lease_expires_at, last_error_code
FROM business_event_deliveries
WHERE status <> 'delivered'
ORDER BY created_at;
```

HTTP_5xx/TIMEOUT/NETWORK_ERROR：恢复接收方后等待重试；REALTIME_UNAVAILABLE：恢复共享总线。DESTINATION_NOT_CONFIGURED：核对原目的地与订阅配置。不要删除待投递记录、修改已提交 payload、把失败记录直接改为 delivered，或为补发生成新事件身份。部署前应用对应新增迁移；SQLite repair 可重复执行。

## 后续完整验收

1. 最终源码重放前序所有包的关键用例，确认无回归；本地和 PostgreSQL 企业云分别保留本轮证据。
2. 在 PostgreSQL 双实例、真实财务角色浏览器及受控接收端串起跨入口重放、进程中断、租约接管和接收方幂等入账，再审查是否晋级 `payment-event-audit-once`。
3. 回款登记的持久请求键与事实指纹仍是独立未完成项；本包不以核销事件唯一冒充“重复提交”和数据库重启整链都已解决。

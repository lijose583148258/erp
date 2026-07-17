# CRM公海私海与分配回收方案（当前版）

## 目标

把 CRM 的客户归属从“页面概念”变成“可审计、可回收、可派发”的正式业务模型。

## 设计原则

1. 一个客户在任意时刻只能有一个明确的主归属。
2. 私海由销售个人或销售团队承担主责任。
3. 公海是共享池，不等于“没人管”，而是“未分配但可领取/可派发”。
4. 分配、转派、回收都必须留痕。
5. 经理可以看全局，但不能绕过审计直接改历史。

## 推荐模型

### 私海

- 客户归属销售员
- 业务责任明确
- 销售只能看到自己名下的客户
- 经理可以看到团队/组织范围

### 公海

- 客户暂不绑定销售员，或者绑定为共享池归属
- 销售可领取，但必须满足规则
- 领取后自动转入私海
- 需要保留领取来源和时间

## 建议字段

现有 `salespersonId` 可以继续作为“私海负责人”的基础字段，但公海治理需要补充以下概念：

- `poolType`：`private` / `public`
- `ownerType`：`user` / `team` / `pool`
- `ownerId`
- `ownerTeamId`
- `assignedAt`
- `assignedBy`
- `assignedReason`
- `claimedAt`
- `claimedBy`
- `reclaimedAt`
- `reclaimedBy`
- `reclaimReason`
- `assignmentStatus`

## 分配规则

建议参考成熟 CRM 的工作分配思路：

- 新客户默认进入公海或指定团队池
- 线索/客户可按 round robin 分配
- 也可按 load balancing 分配
- 经理可以手动指定分配
- 分配后自动写审计日志

参考：
- [Microsoft Learn - Understand record distribution in assignment rules](https://learn.microsoft.com/en-us/dynamics365/sales/understand-lead-distributions-assignment-rules)
- [Microsoft Learn - Configure assignment methods and rules for queues](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/configure-assignment-rules)

## 回收规则

建议优先定义这些场景：

- 超时未跟进
- 连续无有效动作
- 销售离职或转岗
- 经理重新分配
- 客户质量不达标
- 公海领取后未在 SLA 内激活

回收不建议直接改字段完事，应该形成记录：

- 回收前归属
- 回收后归属
- 回收原因
- 回收人
- 回收时间
- 是否需要审批

## 经理可见范围

- 经理能看团队私海
- 经理能看公海池
- 经理能看领取/转派/回收历史
- 经理能查看负载和未跟进情况
- 经理可以执行手动分配和回收

## 业务权限建议

### 销售

- 查看自己的私海
- 查看公海列表
- 领取符合条件的客户
- 不能回收别人名下客户

### 经理

- 查看团队和公海
- 分配客户
- 回收客户
- 查看全部事件记录

### 管理员

- 查看全局
- 设置分配规则
- 设置回收规则
- 审计追踪和导出

## 结论

当前系统适合先把“私海 + 公海 + 分配/回收审计”做成一套正式台账，再继续扩智能分配和更复杂的 CRM 玩法。

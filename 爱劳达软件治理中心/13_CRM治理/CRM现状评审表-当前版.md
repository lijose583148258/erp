# CRM现状评审表（当前版）

## 评审结论

CRM 现在不是“没有公海私海”，而是“私海基础已经有，公海和回收流程还没有正式收口”。

## 现状表

| 项目 | 当前实现 | 证据 | 评审结论 | 风险等级 |
| --- | --- | --- | --- | --- |
| 私海归属 | 已有 `salespersonId`，销售角色只能查看/修改自己的客户 | [backend/src/controllers/customer.controller.ts](../../backend/src/controllers/customer.controller.ts) | 基础可用 | 中 |
| 公海池 | 前端有 `my/public` 视图和 `isPublicPool` 概念 | [pages/CRM.tsx](../../pages/CRM.tsx) | 概念存在，但未正式落库 | 高 |
| 分配权 | 创建/更新时可写入销售归属，管理员可调整 | [backend/src/controllers/customer.controller.ts](../../backend/src/controllers/customer.controller.ts) | 有入口，但不是正式分配流程 | 高 |
| 回收权 | 未见独立回收单、回收记录、回收审批 | [backend/src/controllers/customer.controller.ts](../../backend/src/controllers/customer.controller.ts) | 未收口 | 高 |
| 经理可见 | 经理/管理员的可见性更宽，但没有独立经理工作台 | [pages/CRM.tsx](../../pages/CRM.tsx) | 可见性存在，治理不完整 | 中 |
| 审计留痕 | 客户创建、修改有审计基础 | [backend/src/controllers/customer.controller.ts](../../backend/src/controllers/customer.controller.ts) | 有基础，但缺少分配/回收事件审计 | 中 |
| 批量导入导出 | 可用，但分散在多个入口 | [components/DataTable.tsx](../../components/DataTable.tsx) | 能用，未平台化 | 中 |

## 当前判断

1. 私海可以继续作为当前主线的基础能力。
2. 公海必须补成正式字段和正式流程，否则只靠前端视图会继续失真。
3. 分配权、回收权、转派权要从“字段修改”升级成“事件记录”。
4. 经理可见范围要从默认宽权限，升级成明确的工作台范围。

## 建议优先级

- P0：正式化公海字段、分配记录、回收记录
- P1：明确经理工作台与销售工作台的可见边界
- P1：统一客户分配/转派/回收审计
- P2：统一批量导入导出和公海领取动作

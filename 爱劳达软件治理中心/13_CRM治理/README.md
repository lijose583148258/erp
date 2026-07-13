# CRM治理台账（当前版）

## 定位
这一组文档只负责 CRM 的治理口径，不替代主线六包，也不替代代码实现说明。

当前重点只有四件事：

1. 公海与私海是否真正分开
2. 客户分配权、派发权、回收权是否有明确流程
3. 业务经理能看到什么、能改什么、能回收什么
4. 哪些 CRM 细节还在增加维护成本，需要优先收口

## 当前结论

- 私海已经有基础：客户与 `salespersonId` 绑定，销售角色只能操作自己的客户
- 公海还没有完全工程化：前端有 `isPublicPool` 视图概念，但后端和数据库没有形成完整的公海治理模型
- 分配/回收还没有正式的单据化流程：目前更像是字段变更，不是完整的 CRM 资产流转
- 经理可见范围有角色基础，但还没有形成专门的经理工作台和转派台账

## 文档目录

- [CRM治理四表总览-当前版](./CRM治理四表总览-当前版.md)
- [CRM客户池流转图-当前版](./CRM客户池流转图-当前版.md)
- [CRM角色权限矩阵表-当前版](./CRM角色权限矩阵表-当前版.md)
- [CRM经理工作台范围说明-当前版](./CRM经理工作台范围说明-当前版.md)
- [CRM开源参考对照-当前版](./CRM开源参考对照-当前版.md)
- [内销分销业务线下的客户池治理方案-当前版](./内销分销业务线下的客户池治理方案-当前版.md)
- [CRM角色权限与客户池流转方案-当前版](./CRM角色权限与客户池流转方案-当前版.md)
- [CRM方案修正说明-当前版](./CRM方案修正说明-当前版.md)
- [CRM治理总方案-当前版](./CRM治理总方案-当前版.md)
- [CRM现状评审表-当前版](./CRM现状评审表-当前版.md)
- [CRM公海私海与分配回收方案-当前版](./CRM公海私海与分配回收方案-当前版.md)
- [CRM细节不足优先级清单-当前版](./CRM细节不足优先级清单-当前版.md)
- [CRM待拆分模块清单-当前版](./CRM待拆分模块清单-当前版.md)
- [CRM扩展层优先级建议-当前版](./CRM扩展层优先级建议-当前版.md)
- [CRM细节不足优先级清单-三档版](./CRM细节不足优先级清单-三档版.md)

## 代码对照

- [pages/CRM.tsx](../../pages/CRM.tsx)
- [backend/src/controllers/customer.controller.ts](../../backend/src/controllers/customer.controller.ts)
- [backend/prisma/schema.prisma](../../backend/prisma/schema.prisma)

## 参考调研

- [Microsoft Learn - Understand record distribution in assignment rules](https://learn.microsoft.com/en-us/dynamics365/sales/understand-lead-distributions-assignment-rules)
- [Microsoft Learn - Delete or deactivate assignment rules](https://learn.microsoft.com/en-us/dynamics365/sales/wa-delete-deactivate-assignment-rule)
- [Microsoft Learn - Configure assignment methods and rules for queues](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/configure-assignment-rules)
- [Microsoft Learn - Business units and record access](https://learn.microsoft.com/en-us/dynamics365/customer-insights/journeys/business-units)

## 当前治理建议

- 先把公海/私海/分配/回收的规则正式化，再继续扩 CRM 的高级能力
- 大文件后续再拆，但先不要把 CRM 功能继续散落到多个页面里
- 批量导入导出、经理看板、自动分配都应该在这组台账里单独排优先级
- 当前通用 CRM 方案先保留为基础层，后续按内销 / 分销再补业务分线层
- 方案修正后要优先参考开源项目的团队/区域/分配思路，而不是只套普通 CRM 公海模板
- 经理工作台要按业务线池子来做，不要做成单纯的“客户大列表”
- 细节不足优先级按“立刻影响维护 / 会影响上线 / 只是美化治理”三档排

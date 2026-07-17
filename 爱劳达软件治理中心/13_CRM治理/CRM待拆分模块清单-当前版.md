# CRM待拆分模块清单（当前版）

## 为什么要拆

CRM 现在的代码不是不能用，而是有几个大文件把职责堆得太满。继续往里加功能，后面会越来越难维护。

## 优先拆分对象

### 1. `pages/CRM.tsx`

当前问题：

- 同时承担列表、筛选、视图切换、创建、导入、分页、弹窗等职责
- 公海/私海切换、数据转换、模板预填都混在一起

建议拆成：

- `CRMPageShell`
- `CRMViewSwitcher`
- `CRMCustomerTable`
- `CRMCustomerFormDrawer`
- `CRMAssignmentPanel`
- `CRMAuditDrawer`

### 2. `backend/src/controllers/customer.controller.ts`

当前问题：

- 列表查询
- 创建/更新/删除
- 导入导出
- 权限控制
- 客户归属逻辑

都在一个控制器里，职责偏重。

建议拆成：

- `customer.query.service`
- `customer.command.service`
- `customer.assignment.service`
- `customer.import-export.service`
- `customer.audit.service`

### 3. `backend/prisma/schema.prisma` 里的客户扩展字段

当前问题：

- 私海是有字段基础的
- 公海还没有正式的独立字段模型

建议拆成概念层：

- 归属字段
- 池子字段
- 分配事件表
- 回收事件表

### 4. 批量导入导出逻辑

当前问题：

- 不同模块各自处理导入/导出
- 字段映射、大小限制、错误提示不统一

建议拆成共享服务：

- 导入模板定义
- 字段映射器
- 校验器
- 错误回传格式
- 导出格式器

## 拆分顺序建议

1. 先拆 `pages/CRM.tsx`
2. 再拆 `customer.controller.ts`
3. 再把公海/私海事件表独立出来
4. 最后统一批量导入导出框架

## 目标

把 CRM 做成：

- 页面清楚
- 逻辑清楚
- 权限清楚
- 归属清楚
- 审计清楚

而不是一个越来越大的单页工作台。

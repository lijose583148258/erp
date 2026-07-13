# 前端 Active Path 清单

更新时间：2026-04-13

## 唯一运行入口

- 应用入口：[App.tsx](F:/爱牢达/App.tsx)
- 内容路由入口：[appContent.tsx](F:/爱牢达/app/appContent.tsx)

## 当前 active page 映射

- `dashboard` -> [Dashboard.tsx](F:/爱牢达/pages/Dashboard.tsx)
- `crm` -> [CRM.tsx](F:/爱牢达/pages/CRM.tsx)
- `orders` -> [SalesOrders.tsx](F:/爱牢达/pages/SalesOrders.tsx)
- `risk` -> [RiskControl.tsx](F:/爱牢达/pages/RiskControl.tsx)
- `samples` -> [Samples.tsx](F:/爱牢达/pages/Samples.tsx)
- `shipping` -> [Shipping.tsx](F:/爱牢达/pages/Shipping.tsx)
- `rma` -> [RMA.tsx](F:/爱牢达/pages/RMA.tsx)
- `team` -> [TeamManagement.tsx](F:/爱牢达/pages/TeamManagement.tsx)
- `audit` -> [AuditLogs.tsx](F:/爱牢达/pages/AuditLogs.tsx)
- `assets` -> [Assets.tsx](F:/爱牢达/pages/Assets.tsx)
- `production` -> [ProductionWorkspace.tsx](F:/爱牢达/pages/ProductionWorkspace.tsx)
- `dealerAnalytics` -> [DealerAnalytics.tsx](F:/爱牢达/pages/DealerAnalytics.tsx)
- `procurement` -> [Procurement.tsx](F:/爱牢达/pages/Procurement.tsx)
- `barter/timber` -> [BarterWorkspace.clean.tsx](F:/爱牢达/pages/BarterWorkspace.clean.tsx)
- `contracts` -> [Contracts.tsx](F:/爱牢达/pages/Contracts.tsx)
- `financeAnalytics` -> [FinanceAnalyticsWorkspaceV2.tsx](F:/爱牢达/pages/FinanceAnalyticsWorkspaceV2.tsx)
- `adjustment` -> [AdjustmentCenterView.tsx](F:/爱牢达/pages/adjustment/AdjustmentCenterView.tsx)
- `collections` -> [CollectionCenterView.tsx](F:/爱牢达/pages/collections/CollectionCenterView.tsx)

## 当前桥接文件

这些文件属于“单向转发层”，可以保留，但后续要明确不再承载业务实现：

- [ProductionWorkspace.tsx](F:/爱牢达/pages/ProductionWorkspace.tsx) -> 转发到 `ProductionWorkspaceV2`
- [AdjustmentCenter.tsx](F:/爱牢达/pages/AdjustmentCenter.tsx) -> 转发到 `adjustment/AdjustmentCenterView`
- [Samples.tsx](F:/爱牢达/pages/Samples.tsx) -> 转发到 `Samples.current`
- [TeamManagement.tsx](F:/爱牢达/pages/TeamManagement.tsx) -> 转发到 `TeamManagement.current`
- [crm/useCRM.live.tsx](F:/爱牢达/pages/crm/useCRM.live.tsx) -> 转发到 `useCRM.tsx`

## 当前历史残留候选

这些文件目前不是 active path 主入口，应视为 A6 清理对象：

- [BarterWorkspace.tsx](F:/爱牢达/pages/BarterWorkspace.tsx)
- [BarterWorkspace.current.tsx](F:/爱牢达/pages/BarterWorkspace.current.tsx)
- [crm/CRMCreateModal.tsx](F:/爱牢达/pages/crm/CRMCreateModal.tsx)
- [crm/CRMCustomerDrawer.tsx](F:/爱牢达/pages/crm/CRMCustomerDrawer.tsx)
- [crm/useCRM.ts](F:/爱牢达/pages/crm/useCRM.ts)
- [sales-orders/SalesOrderColumns.tsx](F:/爱牢达/pages/sales-orders/SalesOrderColumns.tsx)

## A6 后续动作

1. 给所有历史残留文件标记 `legacy` 注释头
2. 继续核对这些文件是否仍被任何 service 或 modal 间接引用
3. 确认无引用后再归档，不直接硬删

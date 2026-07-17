# Barter Service 拆分与供应商目录权限修复 2026-04-21

## 本包目标

- 将 `backend/src/services/barter.service.ts` 从巨型货抵服务拆成更清楚的协议、查询、对手方校验与主过账服务。
- 不改变货抵金额计算、不改变分批执行、不改变过账、反冲、库存出入库和回款抵扣逻辑。
- 在验收过程中修复一个真实暴露的问题：供应商列表只有权限门禁，没有正确区分目录可见性和敏感数据范围。

## 拆分结果

- `backend/src/services/barter.service.ts`
  - 保留预览、创建独立货抵单、审批、过账、反冲等高风险主事务。
  - 协议、分批、查询改为薄代理入口。

- `backend/src/services/barter/barter-counterparty.service.ts`
  - 承接客户/供应商/订单关联校验。

- `backend/src/services/barter/barter-agreement.service.ts`
  - 承接货抵协议列表、协议详情、创建协议、按协议创建分批执行单、协议执行进度同步。

- `backend/src/services/barter/barter-query.service.ts`
  - 承接货抵总览、执行单列表、执行单详情。

## 权限修复

- 文件：`backend/src/controllers/procurement.controller.ts`
- 问题：供应商列表原先只靠 `procurement.suppliers.read` 进门，未对返回行叠加 `procurement_visible` 数据范围，导致自定义无数据范围角色也能读到真实供应商行。
- 修复：拆分两层语义。
  - 目录可见性：内销销售可看供应商基础名称，用于货抵/联想选择。
  - 敏感可见性：只有 `procurement_visible` 能看联系人、地址等敏感资料。
  - 自定义角色只有读权限但没有 `procurement_visible` 时，接口保持 200，但返回空行，避免泄漏。

## 验收证据

- `npm --prefix backend run build`：通过。
- `npm run lint`：通过。
- `node scripts/effective-source-mojibake-gate-v1.cjs`：通过，扫描 428 个有效源码文件，未发现源码乱码。
- 稳定运行链已重启：
  - URL：`http://127.0.0.1:5001`
  - Runtime DB：`D:\AilaoDaRuntime\stable.db`
- `node scripts/operations-data-scope-audit-v1.cjs`：通过。
  - 证明无 `procurement_visible` 的自定义角色不再泄漏供应商 fixture。
- `node scripts/supplier-permission-api-audit-v1.cjs`：通过。
  - 证明销售仍可查询供应商基础名称用于货抵/联想选择，敏感字段仍脱敏。
- `node scripts/procurement-api-audit-v1.cjs`：通过。
- `node scripts/barter-permission-api-audit-v1.cjs`：通过。
- `node scripts/barter-browser-audit-v2.cjs`：通过。
  - 报告：`output/playwright/barter-audit-report-v2.json`
- `node scripts/verify-barter-stock-closure.cjs`：通过。
  - 证明货抵过账后我方货物出库、对方货物入库，反冲后库存恢复。
- `node scripts/concurrency-reconcile-deep-audit-v1.cjs`：通过。
  - 证明并发场景未发现重复或漂移。
- `npm run verify:phase3`：通过 13/13。
- `node scripts/full-codebase-audit-v1.cjs`：warning，当前剩余 `P1=1 / P2=9`。

## 反思与剩余风险

- 本包没有把过账和反冲再拆出去，这是刻意保守：它们同时影响回款、库存和协议进度，后续应在更多回归脚本覆盖后再拆。
- 供应商目录权限修复说明：全局治理不能只盯当前文件，真实业务链路会通过验收脚本暴露横向权限漏洞。
- 剩余 P2 已从后端主链路转向前端大文件、审计脚本和翻译大文件；后续应优先处理 `pages/crm/useCRM.tsx` 和 `pages/Procurement.tsx`，因为它们直接影响人工操作维护成本。

# 全仓 TypeScript 清零与阶段 3 回归记录 2026-04-21

## 1. 本包目标

本包属于阶段 3 的基础治理包。

目标是把前端全仓 `tsc --noEmit` 从红灯清零，避免后续本地长期运行和服务器迁移时出现“构建能过，但类型入口到处漂”的维护风险。

本包只修低风险类型契约、配置边界和响应映射，不重写业务流程，不改变页面风格。

## 2. 修复范围

| 文件 | 问题 | 修复 |
| --- | --- | --- |
| `services/aiSecurity.ts` | `SafeAIContext` 传给 AI 命令处理器时缺少索引签名 | 让安全上下文显式继承 `Record<string, unknown>` |
| `pages/CRM.tsx` | 客户导入回调与通用表格导入泛型不一致 | 在页面入口做导入行包装，不改 CRM 导入业务 |
| `pages/ReceiptDiscrepancyWorkbench.tsx` | 容差规则类型只在 config 中使用，页面本身未导入 | 补齐 `ReceiptTolerance*` 类型导入 |
| `services/freeAI/tableRecognition.ts` | `unknown[]` reduce 结果未收窄 | 使用 `reduce<number>` 固定数值累加 |
| `types.ts` | `Shipment` / `RmaRecord` 缺少服务层已使用字段 | 增加 `deliveredAt`、`orderId`、`refundAmount`、`requestDate` 等可选字段 |
| `services/shipping.service.ts` | 发货响应映射缺少必填 UI 字段，日期来源是 `unknown` | 补齐 `customerName`、`sku`、`qty`、`receiptNo`，日期转字符串后再解析 |
| `services/order.service.ts` | 订单响应对象未显式满足 `SalesOrder` 必填字段 | 显式构造 `SalesOrder` 后再进入商业状态装饰器 |
| `tsconfig.json` | `utils/quarantine` 隔离区旧 mock 被当前 `tsc` 扫到 | 排除隔离区，避免旧坏文件影响当前有效源码 |
| `vite.config.ts` | `build.minify` 字面量类型未收窄 | 使用 `as const` 固定为 Vite 接受的字面量 |

## 3. 验收证据

所有命令均遵守 5 分钟上限。

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| `npx tsc --noEmit` | PASS | 前端全仓 TypeScript 清零 |
| `npm run build` | PASS | 前端生产构建通过 |
| `npm --prefix backend run build` | PASS | 后端 TypeScript 构建通过 |
| `npm run lint` | PASS | ESLint 通过 |
| `node .\scripts\effective-source-mojibake-gate-v1.cjs` | PASS | 有效源码 392 个文件，乱码 findings 为空 |
| `npm run start:stable` | PASS | 稳定入口重启到 `http://127.0.0.1:5001/` |
| `scripts/check-runtime.ps1` | PASS | health/home/manifest/icon/sw/JS/CSS 全部 200 |
| `npm run verify:phase3:browser` | PASS | 阶段 3 浏览器集合 12/12 |
| `npm run verify:release:core` | PASS | 核心发布验证 10/10，报告 `output/audit/release-verification-v1-core-2026-04-21T07-37-32-600Z.json` |
| release 后重启稳定入口 + runtime 复核 | PASS | 避免 release 验收中 build 之后未复核运行入口的假绿 |

## 4. 反思

本包没有偏离阶段 3：

1. 先修类型契约和隔离边界，而不是继续堆页面补丁。
2. 没有删除用户数据、历史资料和治理记录。
3. 没有改变现有设计风格。
4. 让隔离区不再污染当前有效源码类型检查，符合“旧坏文件隔离”的制度。
5. 修复后不是只跑 `tsc`，而是补齐了运行入口、浏览器集合和核心发布验证。

## 5. 下一包建议

下一包建议进入生产/BOM 化工链路：

1. 验证 10+ 原料 BOM 的真实输入和保存回读。
2. 验证少耗用原料时后端必须阻止假完工。
3. 验证补齐原料后生成原料扣减、成品入库、成本凭证。
4. 支持原料代号录入，保护配方敏感信息。
5. 继续保持 `tsc --noEmit`、乱码闸门、阶段 3 浏览器集合为默认验收。

# CRM useCRM 拆分执行记录_2026-04-21

## 范围

- 本包只处理 CRM 前端 hook 的维护性问题，不改变客户数据结构、接口契约、权限模型和既有视觉风格。
- 目标是把 `pages/crm/useCRM.tsx` 中的导入解析和表格列配置拆出去，降低后续客户池、三语名称、多地址、多联系人继续扩展时的维护成本。

## 本次改动

- 新增 `pages/crm/useCRMImport.ts`：
  - 集中处理客户导入行解析。
  - 支持中英文列名、三语名称、别名/历史名、多联系人、多地址、信用额度、账期、风险等级、业务线、客户池等字段。
  - 保留原有 `normalizeCustomerAddresses` 和 `splitCustomerTextList` 兜底逻辑。
- 调整 `pages/crm/CRMColumns.tsx`：
  - 接管 CRM 列表列配置。
  - 统一业务线、客户池、风险等级显示口径。
  - 修复中文界面中 `Business Line / Pool / LOW` 的英文残留，改为当前语言翻译键与安全兜底。
- 调整 `pages/crm/useCRM.tsx`：
  - 删除内联导入解析工具。
  - 删除内联表格列 JSX。
  - 通过 `formatImportedCustomers` 和 `buildCRMColumns` 组合业务逻辑。

## 三步法复核

### 1. 翻译

- 看到的 `鐩撮攢`、`鍏捣` 这类输出来自 PowerShell `Get-Content` 显示层误解码。
- Node 以 UTF-8 读取源码时能确认 `直销`、`公海`、`私海` 均存在。
- 浏览器 DOM 真实显示也为中文标签。

### 2. 判断

- 源码没有被错误编码破坏。
- 真实缺陷是 CRM 表格中存在英文硬编码表头和风险等级枚举直出：
  - `Business Line`
  - `Pool`
  - `LOW / MEDIUM / HIGH`

### 3. 修复

- 不重写文件。
- 不改数据库。
- 不改接口。
- 只把显示口径收敛到翻译键：
  - `crmBusinessLine / businessLine`
  - `crmCustomerPool`
  - `crmRiskLevel / riskLevel`
  - `crmSegmentDirect / crmSegmentChannel / crmSegmentMixed`
  - `crmPoolPublic / crmPoolInternal / crmPoolPrivate`
  - `crmRiskLow / crmRiskMedium / crmRiskHigh / crmRiskCritical`

## 验收证据

- `npx tsc --noEmit`：通过。
- `npm run lint`：通过。
- `node scripts/effective-source-mojibake-gate-v1.cjs`：通过，扫描 429 个当前有效源码文件，无乱码发现。
- `npm run build`：通过，生成新 CRM chunk `assets/CRM-DOfCvDPA.js`。
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-stable-v2.ps1`：通过，稳定入口重启到 `http://127.0.0.1:5001`。
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-runtime.ps1`：通过，首页、manifest、service worker、CSS/JS 资源均为 200。
- `node scripts/crm-dom-probe-v1.cjs`：通过，真实 DOM 读取到客户行、新增按钮、搜索框。
- `node scripts/crm-permission-ai-audit-v1.cjs`：通过，AI 与客户权限隔离未回退。
- `node scripts/crm-masterdata-browser-audit-v1.cjs`：通过，客户主数据浏览器链路未回退。
- `node scripts/crm-ai-assistant-browser-audit-v1.cjs`：通过。
- `npm run verify:phase3`：通过，13/13。
- `node scripts/full-codebase-audit-v1.cjs`：warning，剩余 `P1=1 / P2=8`；`pages/crm/useCRM.tsx` 已退出大文件问题清单。

## 当前结果

- `pages/crm/useCRM.tsx`：约 521 行。
- `pages/crm/useCRMImport.ts`：约 115 行。
- `pages/crm/CRMColumns.tsx`：约 111 行。
- CRM 当前浏览器中文表头已显示为：
  - 客户名称
  - 资质状态
  - 负责人
  - 业务线
  - 客户池
  - 风险等级
- CRM 当前浏览器行内状态已显示为：
  - 内销直销 / 分销渠道 / 混合经营
  - 公海 / 内部池 / 私海
  - 低风险 / 中风险 / 高风险

## 反思

- 这次不应该只看 TypeScript 和 API，通过浏览器 DOM 才发现英文残留，这符合“人工审查才能抓到的问题”。
- PowerShell 输出层乱码不能直接当源码损坏，否则会重复制造错误补丁；后续遇到乱码继续默认执行“翻译、判断、修复”三步法。
- 当前包是维护性拆分，不是业务大改；风险控制正确。
- 下一包应继续处理全仓审计剩余的大文件，不要再在 CRM hook 内堆逻辑。

## 下一包建议

1. `pages/Procurement.tsx`：供应商列表、右侧新增供应商表单、采购单、收货/入库入口已经混在一个大页里，建议先拆成采购工作台 shell、供应商子面板、采购订单子面板。
2. `pages/ProductionWorkspaceV2.tsx`：生产、BOM、工单、成本、质检、库存联动均在一个大页里，建议按“BOM 网格 / 工单 / 成本凭证 / 批次追踪”拆。
3. `pages/WarehouseWorkspace.tsx`：仓库、库位、库存余额、出入库流水、批次查询可拆成稳定子组件。
4. `translations/*.ts`：翻译文件已超过 1000 行，建议下一阶段按模块拆分并保留统一导出，避免后续多语言继续污染。

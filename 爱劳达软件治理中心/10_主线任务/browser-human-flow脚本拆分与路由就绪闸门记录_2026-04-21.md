# browser-human-flow 脚本拆分与路由就绪闸门记录 2026-04-21

## 本包目标

- 把 `scripts/browser-human-flow-audit-v1.cjs` 从巨型脚本拆回“调度入口 + 模块定义”的结构，降低后续人工点测维护成本。
- 不改变业务页面、不改变测试数据含义、不删除历史证据。
- 继续执行“乱码三步法 + 禁乱码闸门 + 5 分钟上限 + 反幻觉验收”。

## 改动范围

- `scripts/browser-human-flow-audit-v1.cjs`
  - 保留 CLI、运行计划、浏览器启动、报告写入和全局 watchdog。
  - 删除内嵌的大块模块实现，改为从 `scripts/lib/browser-human-flow-modules.cjs` 注入。

- `scripts/lib/browser-human-flow-modules.cjs`
  - 新增人工流模块集合：CRM、订单/回款、出货、采购/仓储、回款/调账、生产烟测。
  - 当前文件 554 行，低于当前全仓大文件预警阈值。

- `scripts/lib/browser-human-flow-audit-utils.cjs`
  - 修复 `openHash` 的假就绪问题。
  - 旧逻辑只等待固定 1.2 秒，并用侧边栏文案判断路由已打开，可能在页面主体仍为 `LOADING...` 时继续点击。
  - 新逻辑会等待页面匹配路由文案且不再显示 `LOADING... / 加载中 / 載入中 / Đang tải`，再截图和执行后续动作。

## 本轮发现

- `production` 模块返回 `not_covered` 是脚本设计上的诚实标记，不应被宣称为完整人工闭环通过。
- `crm` 模块首次失败的根因不是 CRM 页面损坏，而是浏览器审计脚本误判页面就绪：
  - 失败证据：`crm-open-create` 找不到 `[data-testid="crm-add-customer"]`。
  - 截图显示页面主体仍为 `LOADING...`。
  - 独立 60 秒探针确认 CRM 页面可正常加载，`crm-add-customer` 存在。
  - 修复后 `crm` 模块真实浏览器建档、保存、回读通过。

## 验收证据

- 语法检查：
  - `node -c .\scripts\browser-human-flow-audit-v1.cjs`
  - `node -c .\scripts\lib\browser-human-flow-modules.cjs`
  - `node -c .\scripts\lib\browser-human-flow-audit-utils.cjs`

- 乱码闸门：
  - `node .\scripts\effective-source-mojibake-gate-v1.cjs`
  - 结果：`passed`，扫描 446 个有效源码文件，无 findings。

- 静态闸门：
  - `npm run lint`
  - `npx tsc --noEmit`
  - 均通过。

- 全仓审计：
  - `node .\scripts\full-codebase-audit-v1.cjs`
  - 当前结果：`P1=1 / P2=4`。
  - 本包使 P2 从 5 降到 4。

- 浏览器人工流：
  - `node .\scripts\browser-human-flow-audit-v1.cjs --list-modules`
  - `node .\scripts\browser-human-flow-audit-v1.cjs --module=crm`
  - 结果：`browser human flow audit passed`。
  - 报告：`output/playwright/browser-human-flow-audit-report-v1.json`。

## 剩余风险

- `backend/prisma/schema.prisma` 仍是 P1 大文件，但 Prisma schema 不能像普通 TS 文件那样随意拆分，后续应按迁移策略处理。
- `scripts/procurement-api-audit-v1.cjs` 仍是 P2，应继续拆成采购审计数据、API 客户端、断言 helpers。
- `translations/zh.ts`、`translations/en.ts`、`translations/vi.ts` 仍是 P2，大翻译包建议后续按模块命名空间拆分，但必须保持 i18n 读取兼容。

## 反思结论

- 这次方向没有偏离：没有继续堆业务补丁，而是把“人工验收链本身不可信”的问题修正了。
- 更重要的是修掉了一个反复误导判断的点：只看导航文字会让测试在页面还没真正加载时继续点击。
- 后续所有浏览器级人工点测都应复用这个路由就绪闸门，否则会重复出现“页面实际还在加载，但脚本已经开始操作”的假失败。

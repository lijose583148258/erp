# Full Codebase Audit 策略拆分执行记录 2026-04-21

## 本包目标

继续降低治理脚本维护成本，避免全仓审计器本身变成新的大文件风险。

## 改动内容

| 文件 | 改动 |
| --- | --- |
| `scripts/full-codebase-audit-v1.cjs` | 移除静态扫描策略常量，只保留扫描流程、分析逻辑、报告生成 |
| `scripts/lib/full-codebase-audit-policy.cjs` | 新增审计策略常量：排除目录、排除前缀、有效扩展名、源码扩展名 |

## 为什么这样拆

1. 这属于低风险结构拆分，不改变审计判断规则。
2. 策略常量独立后，后续新增排除目录或扩展名不需要进入 500+ 行主脚本。
3. 主审计脚本从 601 行降到 555 行，退出 P2 大文件告警。
4. 全仓审计 findings 从 P2 19 项降到 18 项，剩余项更聚焦在真实业务大文件和前端页面大文件。

## 验收证据

| 验收项 | 结果 |
| --- | --- |
| `node scripts\full-codebase-audit-v1.cjs` | PASS with WARNING；无 P0，P2 从 19 降到 18 |
| `npm run lint` | PASS |
| `node scripts\effective-source-mojibake-gate-v1.cjs` | PASS |
| `npm run verify:release:core` | PASS，11/11 |

## 注意

PowerShell 默认编码读取 `output/audit/full-codebase-audit-v1.json` 时仍可能把中文路径显示成乱码，甚至导致 `ConvertFrom-Json` 假失败。遇到报告乱码时继续执行固定制度：

1. 先翻译/还原意图。
2. 判断层级：源码、构建产物、终端显示、报告读取。
3. 只修正确层级。

推荐读取方式：

```powershell
Get-Content -LiteralPath 'output/audit/full-codebase-audit-v1.json' -Encoding UTF8 -Raw | ConvertFrom-Json
```

或：

```powershell
node -e "JSON.parse(require('fs').readFileSync('output/audit/full-codebase-audit-v1.json','utf8')); console.log('OK')"
```

# 阶段3 Casbin Fallback 严格权限收口_2026-04-23

## 背景

本包处理动态 RBAC 授权的一个隐性风险：当 `auth_role_permissions` 等动态权限表异常或缺失时，Casbin 授权层过去会回退到内置 `ROLE_POLICIES`。

这个回退在开发或首次修复阶段有价值，但在生产/稳定包运行时会造成假绿风险：

| 风险 | 后果 |
| --- | --- |
| 动态权限表损坏但授权仍然放行 | 超级管理员在 UI 里配置的权限可能被绕过 |
| 审计只看到接口可用 | 实际没有证明权限来自数据库 |
| 阶段 3 报告误判为通过 | 线上迁移后权限链可能炸在真实用户侧 |

## 本轮改动

| 文件 | 改动 |
| --- | --- |
| `backend/src/permissions/casbinAuthorization.ts` | 生产模式下默认禁止内置 RBAC 回退；只有显式设置 `AILAODA_ALLOW_RBAC_FALLBACK=1` 才允许应急回退 |
| `scripts/lib/casbin-fallback-probe-worker.ts` | 新增隔离探针，分别验证严格模式失败关闭和显式回退可用 |
| `scripts/casbin-fallback-policy-audit-v1.cjs` | 新增审计脚本，并把探针运行时的 `LOG_DIR/BACKUP_DIR/UPLOAD_DIR` 隔离到 `output/audit/casbin-fallback-probe`，避免预期失败污染真实 `logs/error.log` |
| `scripts/phase3-readiness-audit-v1.cjs` | 接入 `casbin-fallback-policy-chain`，纳入阶段 3 主闸门 |
| `package.json` | 新增 `audit:permissions:casbin-fallback` |

## 当前规则

| 场景 | 行为 |
| --- | --- |
| 开发模式 | 允许内置权限回退，用于首次建库和修复 |
| 生产/稳定包默认模式 | 动态权限表异常时失败关闭，不再静默回退 |
| 生产/稳定包应急模式 | 必须显式设置 `AILAODA_ALLOW_RBAC_FALLBACK=1` 才允许回退 |
| 审计探针 | 使用临时 SQLite 与临时日志目录，不污染真实运行库和真实错误日志 |

## 验收证据

| 验收项 | 结果 |
| --- | --- |
| `node --check scripts\casbin-fallback-policy-audit-v1.cjs` | PASS |
| `npm run audit:permissions:casbin-fallback` | PASS |
| 探针前后 `logs/error.log` 字节数 | 不增长 |
| `npx tsc --noEmit` | PASS |
| `npm run audit:permissions:assignment` | PASS |
| `npm run audit:permissions:role-assignment` | PASS |
| `npm run audit:permissions:audit-read` | PASS |
| `npm run build` | PASS |
| `npm run verify:phase3` | PASS，43/43，failed 0，stuck 0 |

## 反思

本包不是新增业务功能，而是把权限链从“坏了也可能继续放行”改成“坏了必须暴露”。这比继续补 UI 更重要，因为角色权限是本地稳定运行和后续服务器部署的底座。

本轮还暴露出一个反幻觉问题：探针的预期失败如果写入真实 `logs/error.log`，会被阶段 3 静默窗口正确拦截。最终修复采用脚本隔离运行时目录，而不是降低生产错误日志级别，避免把真实生产权限故障降级成警告。

## 后续约束

1. 后续任何动态权限、角色、审计接口改动，都必须跑 `npm run audit:permissions:casbin-fallback`。
2. 宣称阶段 3 通过前必须跑 `npm run verify:phase3`。
3. 不允许为了让报告变绿而把真实 `logger.error` 降级；只能隔离测试噪声或修真实错误。
4. 稳定包生产环境默认不应设置 `AILAODA_ALLOW_RBAC_FALLBACK=1`，除非进入短时应急恢复。

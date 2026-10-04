# 回款核销事件唯一性缺口（2026-10-02，历史复现与修复跟踪）

## 与当前累计基线的关系

源码 `ec34207` 已完成企业云 #36954322546 累计 52 / 52；完整 R2 仍有 15 项未完成。本缺口属于尚未通过的 `payment-event-audit-once`，不是将已通过的“金额并发核销一次”偷换成事件也已验收。

## 确定性复现

- 当前真实 TypeScript 的 `verifyOrderPayment`、`CollectionStateService.verifyPaymentRecord` 已核销快捷分支，以及真实 webhook publisher 一起运行。
- Prisma 仅使用只读桩，指定回款 7 / 订单 9 已为 verified；权限入口通过桩注入允许，故本复现不验证权限。所有数据库写入若发生会立即失败。
- 同一已核销记录再调用两次，接口均成功；产生 **2 条 payment.verified，且事件 UUID 不同**，另有两次站内通知调用。
- `fetch` 被完全拦截在进程内，配置目的地为 example.invalid；真实网络请求为 0，数据库连接为 0，写入尝试为 0。没有向外部系统发送测试通知。
- 脚本：`output/review/reproduce-payment-verified-event-replay.cjs`；结果：`output/review/payment-verified-event-replay-diagnostic.json`。这是源码级定向复现，不是双实例、数据库重启或真实接收方验收。

## 代码根因与相邻缺口

- `backend/src/controllers/order-payment.controller.ts` 忽略服务返回的 `alreadyVerified`，成功后无条件调用两个发布器。
- `backend/src/services/webhook.service.ts` 对未传 event.id 的每次投递生成新 UUID；当前控制器未传固定业务事件 ID。
- `backend/src/services/collection-state.service.ts` 把数量/金额状态变更放在事务内，但核销函数本身没有写核销审计/事务事件；回款中心的另一控制器直接调用同一服务后返回，没有统一发布边界。
- 回款登记仍使用 15 秒 pending 同内容查重，不能代替跨重启、长时间重放的持久请求键。属于 `payment-submit-durable-replay`，不能通过延长时间窗口冒充持久幂等。

## 下一包实现与验收顺序

1. 两个核销入口统一在服务事务内创建唯一核销审计和固定业务事件，幂等重放返回原身份，不伪造新核销。仅给某个控制器加 `if (!alreadyVerified)` 不足以解决“提交后进程退出、事件未发”的缺口。
2. 持久化待投递事件（事务 outbox）与发送状态；每次尝试沿用同一个事件 ID。网络投递可以重试，接收方必须按稳定事件 ID 去重，不承诺网络层天然 exactly-once。
3. 回款登记引入持久请求键与事实指纹，验证不同操作人/订单/金额复用键的冲突；不得复用 15 秒时间窗作为唯一保护。
4. 双实例重复核销、两个入口交叉重放、丢响应后重放、进程中断后恢复、发送失败再投递都必须核对：一笔回款影响、一条核销审计、一个业务事件身份、权限不变。
5. 每个有界子包完成后，在最终源码上重放全部已完成包；本地与企业云分别新建运行，不仅跑当前新增用例。写入断连不得加入盲目全局重试。

以上是 `ec34207` 的缺陷证据，保留，不改写为通过。后续事务 outbox 基础包已实施，详见 `payment-event-outbox-v1.md`；完整 R2 仍为 22 / 37，事件检查需补齐企业云与端到端恢复证据后单独晋级。

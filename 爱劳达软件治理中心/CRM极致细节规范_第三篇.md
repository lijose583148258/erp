# CRM极致细节规范 · 第三篇
**剩余场景 Token 化展开**

> 延续前两篇 Token 基准。本篇覆盖：易货协议结算时间线、财务分析指标卡、
> 审批流操作条、权限矩阵表格、RMA状态时间线、Modal弹窗、两步表单导航、
> 风险评分仪表盘。每个场景标注与已有Token的复用关系。

---

## 一、易货协议结算时间线

### 1.1 协议进度环（圆形进度条）

```css
.barter-progress-ring {
  width: 64px; height: 64px;
  position: relative;
}
.barter-progress-ring svg {
  transform: rotate(-90deg); /* 起点设为12点方向 */
}
.barter-progress-ring .ring-bg {
  fill: none;
  stroke: var(--color-border-tertiary);
  stroke-width: 6;
}
.barter-progress-ring .ring-progress {
  fill: none;
  stroke: var(--color-info-text);
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dashoffset var(--duration-slow) var(--ease-standard);
  /* stroke-dasharray = 周长(2πr, r=29 → ~182)
     stroke-dashoffset = 182 * (1 - progress) */
}
.barter-progress-ring .ring-label {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
```

进度环颜色随完成度变化（复用占用率三档逻辑，但语义相反——这里高完成度是好事）：
```css
/* 0-49%: info色（进行中）
   50-99%: success色（接近完成）
   100%: success色+轻微缩放动效一次 */
.ring-progress.complete {
  stroke: var(--color-success-dot);
}
@keyframes ring-complete-pulse {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.08); }
  100% { transform: scale(1); }
}
.barter-progress-ring.just-completed {
  animation: ring-complete-pulse 400ms var(--ease-standard);
}
```

### 1.2 协议头部布局（进度环+金额并排）

```css
.barter-header {
  display: flex; align-items: center; gap: 16px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border-tertiary);
}
.barter-amounts {
  flex: 1;
  display: flex; flex-direction: column; gap: 4px;
}
.barter-amount-row {
  display: flex; justify-content: space-between;
  font-size: 14px;
}
.barter-amount-row .label { color: var(--text-tertiary); }
.barter-amount-row .value { 
  font-weight: 600; font-variant-numeric: tabular-nums; 
}
```

### 1.3 结算记录时间线条目（复用CRM往来记录时间线样式）

```css
.settlement-item {
  display: flex; gap: 12px;
  padding: 12px 0;
}
.settlement-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--color-success-dot);
  margin-top: 4px; flex-shrink: 0;
}
.settlement-content { flex: 1; }
.settlement-date { font-size: 12px; color: var(--text-tertiary); }
.settlement-detail {
  font-size: 14px; margin-top: 2px;
  display: flex; align-items: center; gap: 8px;
}
.settlement-exchange-arrow {
  color: var(--text-tertiary); font-size: 12px;
}
/* 显示格式: 结算¥50,000  乳化剂A级 ↔ 包装材料 */
```

### 1.4 价格偏差预警卡

```css
.price-deviation-card {
  margin-top: 12px;
  padding: 12px;
  border-radius: var(--radius-md);
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px;
}
/* 偏差<5%: 不显示此卡片
   偏差5-15%: warning样式
   偏差>15%: danger样式 */
.price-deviation-card.warning {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
}
.price-deviation-card.danger {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
}
.deviation-pct {
  font-weight: 700; font-variant-numeric: tabular-nums;
}
```
文案：`当前市价较协议价偏差 +8.6% ⚠ 建议重新评估定价`

---

## 二、财务分析指标卡

### 2.1 卡片容器与数据时间戳

```css
.metric-card {
  padding: 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-tertiary);
  background: var(--color-background-primary);
  display: flex; flex-direction: column; gap: 8px;
}
.metric-card-header {
  display: flex; justify-content: space-between; align-items: flex-start;
}
.metric-label { font-size: 13px; color: var(--text-tertiary); }
.metric-timestamp {
  font-size: 11px; color: var(--text-placeholder);
  display: flex; align-items: center; gap: 4px;
}
.metric-timestamp.realtime {
  color: var(--color-success-text);
}
.metric-timestamp.realtime::before {
  content: '';
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-success-dot);
  animation: live-blink 2s ease-in-out infinite;
}
@keyframes live-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

### 2.2 数值与同比/环比标注

```css
.metric-value {
  font-size: 28px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.metric-change {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 500;
  margin-top: 2px;
}
.metric-change.positive { color: var(--color-success-text); }
.metric-change.negative { color: var(--color-danger-text); }
.metric-change .change-icon {
  font-size: 12px;
}
/* ↑ +12.3% 环比上月 */
```

### 2.3 多货币折算说明条

```css
.currency-note {
  font-size: 11px; color: var(--text-tertiary);
  padding: 8px 12px;
  background: var(--color-background-secondary);
  border-radius: var(--radius-sm);
  margin-top: 4px;
  display: flex; align-items: center; gap: 6px;
}
.currency-note .info-icon {
  font-size: 12px; flex-shrink: 0;
}
```
文案：`ℹ 所有金额已按当日汇率折算为 CNY (1 CNY ≈ 3,400 VND)`，
汇率数字必须是从汇率配置表实时读取的变量，不可硬编码。

### 2.4 经销商分析对比条形图（横向条形）

```css
.dealer-bar-row {
  display: grid;
  grid-template-columns: 100px 1fr 90px;
  gap: 12px;
  align-items: center;
  height: 32px;
}
.dealer-name { font-size: 13px; }
.dealer-bar-track {
  height: 8px; border-radius: var(--radius-full);
  background: var(--color-background-secondary);
  overflow: hidden;
}
.dealer-bar-fill {
  height: 100%; border-radius: var(--radius-full);
  background: var(--color-info-text);
  transition: width var(--duration-slow) var(--ease-standard);
}
.dealer-value {
  font-size: 13px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
```
三个经销商条形图加载时依次延迟出现（瀑布式）：
```css
.dealer-bar-row:nth-child(1) .dealer-bar-fill { transition-delay: 0ms; }
.dealer-bar-row:nth-child(2) .dealer-bar-fill { transition-delay: 100ms; }
.dealer-bar-row:nth-child(3) .dealer-bar-fill { transition-delay: 200ms; }
```

---

## 三、审批流操作条（调整中心）

### 3.1 待审批状态条

```css
.approval-bar {
  height: 48px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px;
  border-radius: var(--radius-lg);
  margin-bottom: 16px;
}
.approval-bar.pending {
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
}
.approval-bar.approved {
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
}
.approval-bar.rejected {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
}
```

### 3.2 内容布局

```css
.approval-info {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px;
}
.approval-info .approval-status-icon {
  width: 20px; height: 20px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
}
.approval-status-icon.pending { background: var(--color-warning-dot); color: white; }
.approval-status-icon.approved { background: var(--color-success-dot); color: white; }
.approval-status-icon.rejected { background: var(--color-danger-dot); color: white; }
```
文案：`待审批 · 申请人: 王刚 · 2026-06-11 10:00`

### 3.3 操作按钮（仅主管可见，权限控制）

```css
.approval-actions {
  display: flex; gap: 8px;
}
.approval-btn {
  height: 32px; padding: 0 16px;
  border-radius: var(--radius-md);
  font-size: 13px; font-weight: 500;
  transition: all var(--duration-fast);
}
.approval-btn.reject {
  background: transparent;
  border: 1px solid var(--color-danger-border);
  color: var(--color-danger-text);
}
.approval-btn.reject:hover { background: var(--color-danger-bg); }

.approval-btn.approve {
  background: var(--color-success-dot);
  color: white;
  border: none;
}
.approval-btn.approve:hover { background: #0D5D48; } /* 加深 */
```

### 3.4 驳回原因输入（点击驳回后展开）

```css
.reject-reason-panel {
  margin-top: 8px;
  padding: 12px;
  background: var(--color-background-primary);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-tertiary);
  /* 展开动效复用前篇 .followup-form-container 的 height过渡模式 */
}
```

### 3.5 已批准/已驳回的只读展示

```css
.approval-result-meta {
  font-size: 12px; color: var(--text-tertiary);
}
/* 已批准: "由 李经理 于 06-11 14:30 批准"
   已驳回: "由 李经理 于 06-11 14:30 驳回 · 原因: 数量异常需重新核对" */
```

---

## 四、权限矩阵表格

### 4.1 表格容器（固定首列+首行，可横向滚动）

```css
.permission-matrix {
  position: relative;
  overflow-x: auto;
  border: 1px solid var(--color-border-tertiary);
  border-radius: var(--radius-lg);
}
.permission-matrix table {
  border-collapse: separate;
  border-spacing: 0;
}
/* 首列(角色名)固定 */
.permission-matrix th:first-child,
.permission-matrix td:first-child {
  position: sticky; left: 0;
  background: var(--color-background-primary);
  z-index: 2;
  box-shadow: 1px 0 0 var(--color-border-tertiary);
}
/* 首行(模块名)固定 */
.permission-matrix thead th {
  position: sticky; top: 0;
  background: var(--color-background-secondary);
  z-index: 1;
}
.permission-matrix thead th:first-child { z-index: 3; }
```

### 4.2 单元格（4个CRUD checkbox）

```css
.permission-cell {
  width: 120px; height: 48px;
  display: flex; align-items: center; justify-content: center;
  gap: 4px;
}
.permission-checkbox {
  width: 18px; height: 18px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--color-border-tertiary);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700;
  cursor: pointer;
  transition: all var(--duration-fast);
}
/* 4个checkbox分别标注 增/删/改/查 的首字母或图标，hover时tooltip显示全称 */
.permission-checkbox.checked {
  background: var(--color-info-text);
  border-color: var(--color-info-text);
  color: white;
}
.permission-checkbox:hover:not(.checked) {
  border-color: var(--color-info-border);
  background: var(--color-info-bg);
}
```

### 4.3 行级"全选/管理员"高亮

```css
.permission-row.admin-role {
  background: var(--color-background-secondary);
}
.permission-row.admin-role .permission-checkbox {
  /* 管理员行默认全部checked且不可编辑 */
  opacity: 0.6;
  cursor: not-allowed;
}
```

### 4.4 批量列操作（点击列头快捷设置整列）

```css
.permission-matrix th {
  cursor: pointer;
  position: relative;
}
.permission-matrix th:hover::after {
  content: '点击设置整列';
  position: absolute; bottom: -24px; left: 50%;
  transform: translateX(-50%);
  font-size: 11px; color: var(--text-tertiary);
  background: var(--color-background-primary);
  padding: 2px 8px; border-radius: var(--radius-sm);
  box-shadow: var(--shadow-dropdown);
  white-space: nowrap;
}
```

---

## 五、RMA状态时间线 + 双向跳转链接

### 5.1 横向步骤时间线（区别于工单的纵向/横向通用版）

```css
.rma-timeline {
  display: flex; align-items: center;
  padding: 20px 0;
}
.rma-step {
  display: flex; flex-direction: column; align-items: center;
  flex: 1; position: relative;
}
.rma-step:not(:last-child)::after {
  content: '';
  position: absolute; top: 12px; left: 50%; right: -50%;
  height: 2px;
  background: var(--color-border-tertiary);
  z-index: -1;
}
.rma-step.done:not(:last-child)::after {
  background: var(--color-info-text);
}
```
节点圆圈样式复用第三节"工单步骤进度条"的 `.node.completed/.active/.pending`。

### 5.2 操作人+时间的两行标注

```css
.rma-step-label {
  margin-top: 8px;
  text-align: center;
}
.rma-step-name { font-size: 13px; font-weight: 500; }
.rma-step-operator { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.rma-step-date { font-size: 11px; color: var(--text-placeholder); }
/* 未来步骤(pending)的operator/date留空但保留行高，避免布局跳动 */
```

### 5.3 双向跳转链接卡片

```css
.related-link-card {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-tertiary);
  background: var(--color-background-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--duration-fast);
}
.related-link-card:hover {
  border-color: var(--color-info-border);
  background: var(--color-info-bg);
}
.related-link-card .link-icon {
  width: 28px; height: 28px;
  border-radius: var(--radius-sm);
  background: var(--color-info-bg);
  display: flex; align-items: center; justify-content: center;
}
.related-link-card .link-arrow {
  margin-left: auto;
  color: var(--text-tertiary);
  transition: transform var(--duration-fast);
}
.related-link-card:hover .link-arrow {
  transform: translateX(2px);
  color: var(--color-info-text);
}
```
文案：`关联订单 #ORD-HN-0412  →`

---

## 六、Modal 弹窗 — 全系统统一规范

> 这是最高频复用的容器，前面所有场景的"行内表单"是Modal的轻量替代，
> 但凡需要Modal的场景（如客户编辑、批量操作确认），统一遵循以下规范。

### 6.1 尺寸分级

```css
/* 三档尺寸，按内容复杂度选择 */
.modal.size-sm { width: 400px; }   /* 确认框、简单表单 */
.modal.size-md { width: 640px; }   /* 标准编辑表单 */
.modal.size-lg { width: 960px; }   /* 复杂表单(如订单Step2) */
.modal.size-fullscreen { 
  width: 96vw; height: 92vh; 
  /* 已在第二轮报告中诊断过此尺寸在订单编辑器中的问题，
     fullscreen仅用于Step2明细录入，Step1用size-md */
}
```

### 6.2 进入/退出动效

```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  animation: overlay-in var(--duration-base) var(--ease-standard);
}
.modal {
  animation: modal-in var(--duration-slow) var(--ease-decelerate);
}
@keyframes modal-in {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
/* 退出: 反向播放但更快 */
.modal.closing {
  animation: modal-out 160ms var(--ease-accelerate) forwards;
}
@keyframes modal-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.98); }
}
```

### 6.3 Header / Body / Footer 三段式

```css
.modal-header {
  height: 56px; padding: 0 20px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid var(--color-border-tertiary);
}
.modal-title { font-size: 16px; font-weight: 600; }
.modal-close-btn {
  width: 28px; height: 28px;
  border-radius: var(--radius-md);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary);
  transition: all var(--duration-fast);
}
.modal-close-btn:hover {
  background: var(--color-background-secondary);
  color: var(--text-primary);
}

.modal-body {
  padding: 20px;
  max-height: calc(80vh - 56px - 64px); /* 减去header和footer */
  overflow-y: auto;
}

.modal-footer {
  height: 64px; padding: 0 20px;
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  border-top: 1px solid var(--color-border-tertiary);
}
```

### 6.4 关闭按钮的脏检查接入点（与全局useUnsavedForm集成）

```typescript
// modal-close-btn 的onClick统一调用
<button className="modal-close-btn" onClick={() => requestClose(onClose)}>
  ✕
</button>
// Escape键、点击overlay 同样走 requestClose
```

### 6.5 确认类Modal（删除/批量操作）的特殊样式

```css
.modal.confirm-danger .modal-header {
  /* 危险操作头部图标 */
}
.modal.confirm-danger .modal-icon {
  width: 40px; height: 40px;
  border-radius: 50%;
  background: var(--color-danger-bg);
  color: var(--color-danger-dot);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
  margin-bottom: 12px;
}
```

---

## 七、两步表单导航（订单Step1→Step2）

### 7.1 步骤指示器

```css
.step-indicator {
  display: flex; align-items: center; justify-content: center;
  gap: 12px;
  padding: 16px 0;
}
.step-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--color-border-tertiary);
  transition: all var(--duration-base) var(--ease-standard);
}
.step-dot.active {
  width: 24px; border-radius: var(--radius-full);
  background: var(--color-info-text);
}
.step-dot.completed {
  background: var(--color-success-dot);
}
```

### 7.2 步骤切换的滑动过渡

```css
.step-content-wrapper {
  overflow: hidden;
  position: relative;
}
.step-content {
  transition: transform var(--duration-slow) var(--ease-standard);
}
/* Step1→Step2: translateX(0) → translateX(-100%)
   Step2→Step1: translateX(-100%) → translateX(0)
   两个step-content并排放置，width各100%，
   wrapper width: 100%, overflow: hidden */
```

### 7.3 底部导航按钮组

```css
.step-nav-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 0;
  border-top: 1px solid var(--color-border-tertiary);
}
.step-nav-footer .nav-left {
  /* Step1: 空; Step2: [← 上一步] */
}
.step-nav-footer .nav-right {
  display: flex; gap: 8px;
  /* Step1: [保存草稿][下一步→]
     Step2: [保存草稿][创建订单] */
}
```

### 7.4 Step2进入时的焦点管理

Step2展开后，自动将焦点定位到第一个产品选择器的"添加产品"按钮，
避免用户切换Step后找不到操作入口：
```typescript
useEffect(() => {
  if (currentStep === 2) {
    addProductBtnRef.current?.focus();
  }
}, [currentStep]);
```

---

## 八、风险评分仪表盘（CRM风险控制Tab）

### 8.1 总分横向进度条

```css
.risk-score-bar {
  height: 12px; border-radius: var(--radius-full);
  background: var(--color-background-secondary);
  overflow: hidden;
  position: relative;
}
.risk-score-fill {
  height: 100%;
  transition: width var(--duration-slow) var(--ease-standard);
}
/* 颜色按分数区间渐变 */
.risk-score-fill[data-level="low"]    { background: var(--color-success-dot); }  /* <40 */
.risk-score-fill[data-level="medium"] { background: var(--color-warning-dot); }  /* 40-69 */
.risk-score-fill[data-level="high"]   { background: var(--color-danger-dot); }   /* >=70 */

.risk-score-label {
  position: absolute; right: 8px; top: 50%;
  transform: translateY(-50%);
  font-size: 10px; font-weight: 700; color: white;
  font-variant-numeric: tabular-nums;
}
/* 当填充宽度<标签宽度时，标签移到条外右侧并变深色文字，避免文字溢出条外被裁切 */
```

### 8.2 评分构成子项（多个小型水平条）

```css
.risk-factor-row {
  display: grid;
  grid-template-columns: 120px 1fr 60px;
  gap: 12px; align-items: center;
  height: 28px;
}
.risk-factor-label { font-size: 12px; color: var(--text-secondary); }
.risk-factor-bar {
  height: 6px; border-radius: var(--radius-full);
  background: var(--color-background-secondary);
}
.risk-factor-fill {
  height: 100%; border-radius: var(--radius-full);
  background: var(--text-tertiary); /* 子项用中性色，区别于总分的语义色 */
}
.risk-factor-value {
  font-size: 12px; text-align: right;
  font-variant-numeric: tabular-nums;
}
```

### 8.3 历史趋势迷你条形图

```css
.risk-history-chart {
  display: flex; align-items: flex-end; gap: 8px;
  height: 80px; padding-top: 16px;
}
.risk-history-bar {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.risk-history-bar-fill {
  width: 100%; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: height var(--duration-slow) var(--ease-standard);
}
.risk-history-bar-fill[data-level="low"]    { background: var(--color-success-dot); opacity: 0.7; }
.risk-history-bar-fill[data-level="medium"] { background: var(--color-warning-dot); opacity: 0.7; }
.risk-history-bar-fill[data-level="high"]   { background: var(--color-danger-dot); opacity: 0.7; }

.risk-history-bar.current .risk-history-bar-fill {
  opacity: 1; /* 当前周期不透明，历史周期70%透明 */
}
.risk-history-label {
  font-size: 10px; color: var(--text-tertiary);
}
```
加载时从下往上生长动画，每个柱子延迟80ms（复用前篇骨架屏的错位delay模式）：
```css
.risk-history-bar:nth-child(1) .risk-history-bar-fill { transition-delay: 0ms; }
.risk-history-bar:nth-child(2) .risk-history-bar-fill { transition-delay: 80ms; }
.risk-history-bar:nth-child(3) .risk-history-bar-fill { transition-delay: 160ms; }
.risk-history-bar:nth-child(4) .risk-history-bar-fill { transition-delay: 240ms; }
```

---

## 九、三篇规范的Token复用统计

| Token/模式 | 首次定义于 | 本篇复用场景 |
|-----------|-----------|-------------|
| `--duration-slow` + `ease-standard` 展开动效 | 第一篇 跟进表单 | 驳回原因面板、Modal进入、Step切换 |
| 错位delay骨架屏模式 | 第一篇 骨架屏 | 经销商条形图、风险历史趋势图 |
| 单焦点呼吸动效原则 | 第二篇 工单进度条 | （本篇未新增呼吸动效场景，原则延续） |
| tabular-nums数字规范 | 第一篇 客户行金额 | 所有指标卡、对比卡、评分条 |
| 三档颜色映射（占用率/分数/偏差） | 第二篇 库位占用率 | 财务指标、风险评分、价格偏差 |
| 四态输入框 | 第一篇 跟进内容框 | 驳回原因输入框 |
| `requestClose`脏检查接入点 | 第一篇 Escape键 | Modal统一关闭逻辑 |

**结论**：三篇规范已经覆盖CRM、销售订单、生产、仓储、采购、易货、财务、调整中心、
团队权限、RMA共10个模块的核心交互场景。新场景出现时，先查这张表，
大概率可以直接复用已有模式，无需创造新Token。

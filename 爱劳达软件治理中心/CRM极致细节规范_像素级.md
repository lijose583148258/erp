# CRM 极致细节规范
**像素级 · 状态级 · 微交互级 · 飞致云对标**

> 上一版方案是"功能级"——说了要做什么。这一版是"实现级"——
> 每一个尺寸、每一种状态、每一段动效时序都给出可以直接写进代码的数值。
> 聚焦三个最高频场景：客户列表行、跟进表单、客户详情页头部。
> 这套规范作为 Design Token 基准，其余场景按同一套数值类推。

---

## 一、设计 Token 基准（先定义，后面全部引用）

### 1.1 间距系统（8px 基准网格）
```css
--space-1: 4px;   /* 图标与文字间距、紧凑场景 */
--space-2: 8px;   /* 按钮组间距、Chip间距 */
--space-3: 12px;  /* 表单字段内边距 */
--space-4: 16px;  /* 卡片内边距、表单区块padding */
--space-5: 20px;  /* 区块间垂直间距 */
--space-6: 24px;  /* 模块间大间距 */
```
**飞致云对标**：飞致云的字段标签与输入框间距固定为12px，输入框内部左padding 12px，
本系统所有表单字段统一遵循"标签宽度80px + 12px间距 + 输入框"。

### 1.2 字体系统
```css
--text-xs: 12px;   line-height: 16px;  /* 辅助信息、时间戳、计数器 */
--text-sm: 14px;   line-height: 20px;  /* 正文、表格内容、按钮文字 */
--text-base: 14px; line-height: 22px;  /* 表单输入文字 */
--text-lg: 16px;   line-height: 24px;  /* 卡片标题 */
--text-xl: 18px;   line-height: 28px;  /* 页面标题 */

--font-normal: 400;
--font-medium: 500;  /* 客户名称、强调文字 */
--font-semibold: 600; /* 金额数字、关键指标 */

/* 金额数字必须加 */
font-variant-numeric: tabular-nums;  /* 等宽数字，避免列表中金额对不齐 */
```

### 1.3 颜色 Token（语义化，禁止直接写 hex）
```css
/* 状态色 - 浅色模式 */
--color-danger-bg: #FCEBEB;
--color-danger-border: #F7C1C1;
--color-danger-text: #A32D2D;
--color-danger-dot: #E24B4A;

--color-warning-bg: #FAEEDA;
--color-warning-border: #FAC775;
--color-warning-text: #854F0B;
--color-warning-dot: #BA7517;

--color-success-bg: #E1F5EE;
--color-success-border: #9FE1CB;
--color-success-text: #0F6E56;
--color-success-dot: #639922;

--color-info-bg: #E6F1FB;
--color-info-border: #B5D4F4;
--color-info-text: #185FA5;
--color-info-dot: #378ADD;

/* 文字色阶 */
--text-primary: #3d3d3a;    /* 主要文字 */
--text-secondary: #5F5E5A;  /* 次要文字 */
--text-tertiary: #888780;   /* 辅助/占位文字 */
--text-placeholder: #B0AEA6; /* input placeholder */
--text-disabled: #D3D1C7;
```

### 1.4 圆角与阴影
```css
--radius-sm: 4px;   /* 输入框、小Tag */
--radius-md: 6px;   /* 按钮、Chip、卡片内元素 */
--radius-lg: 8px;   /* 卡片、面板 */
--radius-full: 9999px; /* 圆形Tag、头像 */

--shadow-focus: 0 0 0 3px rgba(24, 95, 165, 0.12);  /* 输入框聚焦光环 */
--shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
--shadow-dropdown: 0 4px 12px rgba(0,0,0,0.10);
```

### 1.5 动效时序（统一缓动曲线）
```css
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);  /* 大部分过渡 */
--ease-decelerate: cubic-bezier(0, 0, 0.2, 1);   /* 元素进入 */
--ease-accelerate: cubic-bezier(0.4, 0, 1, 1);   /* 元素退出 */

--duration-fast: 100ms;     /* hover颜色变化、按钮按下 */
--duration-base: 200ms;     /* 大多数过渡、Tooltip出现 */
--duration-slow: 280ms;     /* 面板展开/折叠、Modal进入 */
--duration-toast: 2000ms;   /* Toast停留 */
```

---

## 二、客户列表行 — 三态完整规范

### 2.1 整体行容器

```css
.customer-row {
  height: 44px;
  display: flex;
  align-items: center;
  border-bottom: 0.5px solid var(--color-border-tertiary);
  transition: background-color var(--duration-fast) var(--ease-standard);
  cursor: pointer;
  position: relative; /* 用于操作区绝对定位 */
}
```

### 2.2 列宽分配（精确到px，总宽度=表格容器宽度）

| 列 | 宽度 | 对齐 | 内容 |
|----|------|------|------|
| Checkbox | 40px | center | 14×14px checkbox |
| 客户名称 | flex:1, min 220px | left | 名称(14px/500) + 编码租户(12px/400,行间距2px) |
| 归属销售 | 70px | left | 销售姓名(14px) |
| 最近联系 | 80px | left | 相对时间(14px) |
| 未收款/逾期 | 126px | right | 金额(14px/600) + 逾期标注(12px,红色) |
| 催收等级 | 64px | center | Tag样式 |
| 操作区 | 60px(默认隐藏,悬浮时变180px) | right | 见2.4 |

### 2.3 默认态规范

**客户名称单元（核心，分两行）：**
```
┌─────────────────────────────────┐
│ ● 河内化工贸易                    │  ← 14px/500/#3d3d3a, 圆点r=3px距文字左8px
│   CUS-HN-0042 · dealer_hanoi     │  ← 12px/400/#888780, 上边距2px
└─────────────────────────────────┘
左侧padding: 16px (距checkbox列结束)
圆点r=3px，仅在 riskScore≥40 时显示，颜色按2.5节语义
```

**未收款/逾期单元（右对齐，两行）：**
```
                          ¥83,000   ← 14px/600/tabular-nums/#3d3d3a
                    逾期¥45,000     ← 12px/400/#A32D2D, 仅逾期>0时显示
右侧padding: 16px
若逾期=0，第二行留空(不是隐藏整行，保持44px高度不跳动)
```

**催收等级 Tag：**
```css
.collection-level-tag {
  display: inline-flex;
  width: 32px; height: 20px;
  border-radius: 10px;
  align-items: center; justify-content: center;
  font-size: 12px; font-weight: 500;
}
/* L0: 不显示Tag（留空）
   L1: bg var(--color-warning-bg) text var(--color-warning-text)
   L2/L3: bg var(--color-danger-bg) text var(--color-danger-text) */
```

### 2.4 悬浮态 — 操作区滑入

```css
.customer-row:hover {
  background-color: var(--color-background-secondary);
}

.row-actions {
  position: absolute;
  right: 16px;
  top: 8px;  /* (44-28)/2 垂直居中 */
  display: flex;
  gap: 8px;
  opacity: 0;
  transform: translateX(8px);
  transition: opacity var(--duration-base) var(--ease-standard),
              transform var(--duration-base) var(--ease-standard);
  pointer-events: none;
}

.customer-row:hover .row-actions {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}
```

**操作区背后的渐变遮罩**（避免按钮直接盖在数字上造成视觉断裂）：
```css
.row-actions::before {
  content: '';
  position: absolute;
  right: -16px; top: -8px;
  width: 280px; height: 44px;
  background: linear-gradient(
    to right,
    transparent 0%,
    var(--color-background-secondary) 30%,
    var(--color-background-secondary) 100%
  );
  z-index: -1;
}
```

**4个操作按钮规范：**
```css
.row-action-btn {
  width: 28px; height: 28px;
  border-radius: var(--radius-md);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px;
  background: var(--color-background-primary);
  border: 0.5px solid var(--color-border-tertiary);
  transition: all var(--duration-fast) var(--ease-standard);
}
.row-action-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-card);
}
/* 按钮类型边框色: 跟进=info, 回款=success, 催收=danger, 详情=neutral */
```

### 2.5 选中态（批量操作）

```css
.customer-row.selected {
  background-color: var(--color-info-bg);
}
.customer-row.selected::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background-color: var(--color-info-text);
}
.customer-row.selected .checkbox {
  background-color: var(--color-info-text);
  border-color: var(--color-info-text);
}
/* checkbox内的勾选图标: 白色, 2px描边, stroke-linecap round */
```

### 2.6 风险圆点判定逻辑（精确阈值）

```typescript
function getRiskDotColor(customer: Customer): string | null {
  if (customer.shipmentHold) return 'var(--color-danger-dot)';      // 止货 = 最高优先级
  if (customer.riskScore >= 70) return 'var(--color-danger-dot)';   // 高风险
  if (customer.riskScore >= 40) return 'var(--color-warning-dot)';  // 关注
  return null; // 正常态不显示圆点
}
```

---

## 三、跟进记录行内表单 — 展开动效与状态

### 3.1 折叠态触发按钮

```css
.add-followup-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  background: var(--color-info-bg);
  border: 0.5px solid var(--color-info-border);
  color: var(--color-info-text);
  font-size: 14px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 4px;
}
```

### 3.2 展开动效（高度过渡 + 内容淡入分离）

**关键点：高度变化和内容透明度变化必须分离，否则会出现内容挤压变形的视觉问题。**

```css
.followup-form-container {
  overflow: hidden;
  height: 32px;  /* 初始=折叠按钮高度 */
  transition: height var(--duration-slow) var(--ease-standard);
}
.followup-form-container.expanded {
  height: 268px;
}

.followup-form-content {
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity var(--duration-base) var(--ease-standard) 80ms,  /* 延迟80ms，等容器开始展开 */
              transform var(--duration-base) var(--ease-standard) 80ms;
}
.followup-form-container.expanded .followup-form-content {
  opacity: 1;
  transform: translateY(0);
}
```

**折叠时的反向时序**（先淡出内容，再收起高度）：
```css
/* 折叠触发时先移除 .expanded 类的 content 状态(立即0ms)
   再延迟0ms开始height收起 —— 内容先消失避免溢出可见 */
.followup-form-container:not(.expanded) .followup-form-content {
  transition: opacity 60ms var(--ease-accelerate);
}
```

### 3.3 表单内部精确布局（容器268px拆解）

```
┌─ padding: 16px ──────────────────────────────────┐
│  [标签80px][跟进方式Chips]              ← 行高40px│
│  [标签80px][联系人下拉160px]            ← 行高40px│
│  [标签80px][内容textarea 560×76px]      ← 76+计数器22px│
│  [标签80px][日期120][时间90][方式80]    ← 行高40px│
│  [取消60px][保存60px]   ← 右对齐, 距底12px      │
└────────────────────────────────────────────────┘
16(top) + 40 + 8 + 40 + 8 + 76+22 + 8 + 40 + 12 + 32 + 16(bottom) 
= 268px ✓ (8px为字段间垂直间距 --space-2)
```

### 3.4 跟进方式 Chip 组件状态

```css
.method-chip {
  height: 28px;
  padding: 0 14px;
  border-radius: var(--radius-full);
  font-size: 13px;
  display: inline-flex; align-items: center; gap: 4px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-standard);
}
/* 未选中 */
.method-chip {
  background: transparent;
  border: 0.5px solid var(--color-border-tertiary);
  color: var(--text-secondary);
}
.method-chip:hover {
  border-color: var(--color-info-border);
  background: var(--color-info-bg);
}
/* 选中 */
.method-chip.active {
  background: var(--color-info-text);
  border-color: var(--color-info-text);
  color: white;
}
/* chip间距: gap: 8px (--space-2) */
```

### 3.5 内容输入框 + 字符计数器

```css
.followup-textarea {
  width: 100%; height: 76px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-tertiary);
  font-size: 14px; line-height: 20px;
  resize: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.followup-textarea:focus {
  border-color: var(--color-info-text);
  box-shadow: var(--shadow-focus);
  outline: none;
}
.followup-textarea::placeholder {
  color: var(--text-placeholder);
}

/* 字符计数器 */
.char-counter {
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: right;
  margin-top: 4px;
}
.char-counter.warning { color: var(--color-warning-text); }  /* >450/500 */
.char-counter.error { color: var(--color-danger-text); }     /* =500/500 */
```

### 3.6 输入框四态完整定义（适用于全系统所有输入框）

```css
/* 默认 */
.input { border: 1px solid var(--color-border-tertiary); }

/* 聚焦 */
.input:focus {
  border: 1.5px solid var(--color-info-text);
  box-shadow: var(--shadow-focus);
}

/* 错误（校验失败后） */
.input.error {
  border: 1.5px solid var(--color-danger-dot);
}
.input.error:focus {
  box-shadow: 0 0 0 3px rgba(226, 75, 74, 0.12);
}
/* 错误信息: 12px/--color-danger-text, margin-top 4px, 
   icon: ⚠ 12px 与文字间距4px */

/* 禁用 */
.input:disabled {
  background: var(--color-background-secondary);
  color: var(--text-disabled);
  cursor: not-allowed;
  border-color: var(--color-border-tertiary);
}
```

### 3.7 保存按钮的三个反馈状态

```css
/* 默认 */
.btn-primary {
  height: 32px; padding: 0 16px;
  background: var(--color-info-text);
  color: white; border-radius: var(--radius-md);
  font-size: 14px; font-weight: 500;
  transition: background-color var(--duration-fast);
}
.btn-primary:hover { background: #14528E; }  /* 加深8% */
.btn-primary:active { background: #0F436F; transform: scale(0.98); }

/* 提交中 */
.btn-primary.loading {
  pointer-events: none;
  opacity: 0.7;
}
.btn-primary.loading::before {
  content: '';
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 600ms linear infinite;
  margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* 提交成功后 — 表单收起 + Toast */
/* 时序: 
   1. 按钮短暂显示✓图标(200ms)
   2. 表单容器height过渡到32px(280ms, 延迟100ms开始)
   3. Toast从右下角滑入(同时触发) */
```

---

## 四、客户详情页头部 — 风险状态条精确规范

### 4.1 容器规范

```css
.risk-status-bar {
  height: 36px;
  padding: 0 16px;
  display: flex; align-items: center; gap: 16px;
  font-size: 13px;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0; /* 仅顶部圆角，与下方面板融合 */
}
/* 三种状态对应不同背景，见下 */
```

### 4.2 三种严重程度的视觉差异

**关注态（黄色，可关闭）：**
```css
.risk-status-bar.warning {
  background: var(--color-warning-bg);
  border-bottom: 1px solid var(--color-warning-border);
  color: var(--color-warning-text);
}
/* 右侧有 × 关闭按钮，关闭后24h内不再显示（存localStorage时间戳） */
```

**逾期态（红色，不可关闭）：**
```css
.risk-status-bar.danger {
  background: var(--color-danger-bg);
  border-bottom: 1px solid var(--color-danger-border);
  color: var(--color-danger-text);
}
/* 无关闭按钮 */
```

**止货态（深红+阴影，最高优先级，带轻微呼吸效果）：**
```css
.risk-status-bar.hold {
  background: var(--color-danger-bg);
  border-bottom: 2px solid var(--color-danger-dot);
  color: var(--color-danger-text);
  box-shadow: inset 0 -1px 0 rgba(226,75,74,0.2);
  position: relative;
}
.risk-status-bar.hold .hold-icon {
  animation: pulse-subtle 2s var(--ease-standard) infinite;
}
@keyframes pulse-subtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
/* 注意：仅图标呼吸，不是整条状态栏闪烁——
   避免重复"4.6 第一轮报告里批评的按钮持续闪烁"问题 */
```

### 4.3 内部元素分段规范（精确间距）

```
┌────────────────────────────────────────────────────────────────┐
│ ⛔止货中  |  逾期¥45,000·38天  |  催收L2·承诺明日到期  |  信用余额¥12,000/¥200,000  [解除止货]│
└────────────────────────────────────────────────────────────────┘
```

每段之间用 `|` 分隔符，规范：
```css
.risk-segment {
  display: flex; align-items: center; gap: 6px;
}
.risk-divider {
  width: 1px; height: 14px;
  background: currentColor;
  opacity: 0.25;
}
/* 分隔符高度14px，垂直居中, opacity 0.25保证不抢视觉焦点 */
```

**右侧操作按钮**（"解除止货"）：
```css
.risk-action-btn {
  margin-left: auto; /* 推到最右 */
  height: 24px; padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid currentColor;
  background: transparent;
  font-size: 12px; font-weight: 500;
  transition: background-color var(--duration-fast);
}
.risk-action-btn:hover {
  background: rgba(163, 45, 45, 0.08); /* danger-text的8%透明度 */
}
```

### 4.4 信用额度余额的动态颜色

```typescript
function getCreditBalanceColor(balance: number, limit: number): string {
  const ratio = balance / limit;
  if (ratio < 0.1) return 'var(--color-danger-text)';   // <10% 红色加粗
  if (ratio < 0.3) return 'var(--color-warning-text)';  // <30% 橙色
  return 'inherit';                                      // 正常继承父级颜色
}
```
当余额<10%时，数字额外加 `font-weight: 700`，制造视觉警示层级。

### 4.5 状态条与下方三栏面板的衔接

```css
.customer-detail-container {
  border: 1px solid var(--color-border-tertiary);
  border-radius: var(--radius-lg);
  overflow: hidden; /* 让状态条的圆角和主体融合 */
}
.risk-status-bar {
  /* 见4.1，顶部圆角与容器一致 */
}
.customer-detail-body {
  display: grid;
  grid-template-columns: 240px 1fr 180px;
  /* 三栏之间用1px分隔线，颜色 var(--color-border-tertiary) */
}
```

**无风险时的处理**：状态条整体 `display: none`，但 `.customer-detail-body` 顶部增加 `border-top-radius`
（因为少了状态条，主体本身需要承担顶部圆角），通过条件类切换：
```css
.customer-detail-body.no-risk-bar {
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}
```

---

## 五、Toast 通知 — 完整时序与堆叠规范

### 5.1 单个Toast结构

```css
.toast {
  min-width: 280px; max-width: 360px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background: var(--color-background-primary);
  box-shadow: var(--shadow-dropdown);
  border-left: 3px solid; /* 颜色按类型 */
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 14px;
}
.toast .toast-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.toast .toast-content { flex: 1; }
.toast .toast-close {
  width: 16px; height: 16px;
  opacity: 0.4;
  transition: opacity var(--duration-fast);
}
.toast .toast-close:hover { opacity: 1; }
```

### 5.2 进入/退出动效

```css
/* 进入：从右侧滑入 + 淡入 */
@keyframes toast-in {
  from { transform: translateX(40px); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
.toast { animation: toast-in var(--duration-base) var(--ease-decelerate); }

/* 退出：向上淡出（不是滑出，避免和新Toast进入方向冲突） */
@keyframes toast-out {
  from { transform: translateY(0); opacity: 1; max-height: 80px; margin-bottom: 8px; }
  to   { transform: translateY(-8px); opacity: 0; max-height: 0; margin-bottom: 0; }
}
.toast.leaving { animation: toast-out var(--duration-base) var(--ease-accelerate) forwards; }
```

### 5.3 堆叠规则

```
位置: fixed; right: 20px; bottom: 20px;
堆叠方向: 新Toast出现在最上方（column-reverse）
最大同时显示: 3个
第4个及以后: 进入队列，等待前面的Toast消失后再显示
间距: 8px (margin-bottom)
```

### 5.4 持续时间与类型对应

| 类型 | 边框色 | 图标 | 停留时长 | 可手动关闭 |
|------|--------|------|---------|-----------|
| success | var(--color-success-dot) | ✓ | 2000ms | 是 |
| info | var(--color-info-dot) | ℹ | 3000ms | 是 |
| warning | var(--color-warning-dot) | ⚠ | 3000ms | 是 |
| error | var(--color-danger-dot) | ✕ | 不自动消失 | 必须手动关闭 |

---

## 六、骨架屏 — Shimmer 精确规范

### 6.1 单个骨架块

```css
.skeleton-block {
  background: linear-gradient(
    90deg,
    var(--color-border-tertiary) 0%,
    #EFEEEA 50%,
    var(--color-border-tertiary) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### 6.2 客户列表骨架行（对应2.1的44px行）

```
┌────────────────────────────────────────────────┐
│ □  ▬▬▬▬▬▬▬▬▬▬▬▬ (140×14px)    ▬▬▬(40×12px)  ▬▬▬▬▬│
│    ▬▬▬▬▬▬▬▬ (90×10px,margin-top4px)              │
└────────────────────────────────────────────────┘
显示5行，shimmer动效错位: 每行 animation-delay 递增 80ms
营造"逐行加载"的视觉感，而非所有行同时闪烁(同时闪烁显得呆板)
```

```css
.skeleton-row:nth-child(1) { animation-delay: 0ms; }
.skeleton-row:nth-child(2) { animation-delay: 80ms; }
.skeleton-row:nth-child(3) { animation-delay: 160ms; }
.skeleton-row:nth-child(4) { animation-delay: 240ms; }
.skeleton-row:nth-child(5) { animation-delay: 320ms; }
```

---

## 七、与飞致云的逐项对标差异说明

| 维度 | 飞致云做法 | 本规范采纳/调整 | 原因 |
|------|-----------|----------------|------|
| 行高 | 表格行40px | 改为44px | 越南文姓名常更长，需多2px容错避免换行 |
| 操作区触发 | 始终显示4个图标 | 悬浮才显示 | 默认态信息密度已高，常显图标会拥挤 |
| 状态条 | 仅用色块无图标 | 加图标+呼吸动效(止货态) | 止货是最高优先级事件，需要比飞致云更强的视觉提示 |
| Toast方向 | 顶部居中 | 右下角 | 顶部居中会遮挡飞致云没有的"风险状态条"区域 |
| 金额对齐 | 左对齐 | 右对齐+tabular-nums | 财务数字必须右对齐才能纵向比对大小 |
| Chip选中 | 描边变色 | 实心填充变色 | 实心对比度更高，适合中老年用户群体（中小企业常见） |

---

*本规范的每一个数值都可以直接作为 CSS 变量或 Tailwind 配置写入代码。
后续场景（订单表格行、采购单表单、工单时间线等）按本规范的 Token 体系类推，
保持 8px 网格、四态输入框、统一动效曲线，不需要为每个场景重新定义基础数值。*

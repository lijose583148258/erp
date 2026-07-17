# CRM极致细节规范 · 第五篇
**全局导航壳层 + 看板/内联编辑/对话面板等剩余交互模式**

> 前四篇覆盖了13个业务模块的页面内容区，但"壳层"——侧边导航、顶部栏、面包屑、
> 模块内Tab——这些用户每天看到时间最长的元素反而还没有定义。
> 本篇先补完导航壳层（影响面最大，每个页面都在用），
> 再覆盖看板视图、表格内联编辑、批量工具栏、标签输入、数量单位组合输入、
> 汇率锁定显示、开关/单选组、用户菜单、AI助手面板、打印预览、
> 错误/空状态页面、审计日志查看器。

---

## 一、全局导航壳层

### 1.1 侧边导航容器（可折叠）

```css
.app-sidebar {
  width: 220px;
  height: 100vh;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--color-border-tertiary);
  background: var(--color-background-primary);
  transition: width var(--duration-slow) var(--ease-standard);
}
.app-sidebar.collapsed {
  width: 64px;
}
/* 折叠时所有文字label淡出，仅保留图标 */
.app-sidebar .nav-label {
  opacity: 1;
  transition: opacity var(--duration-fast) var(--ease-standard);
  white-space: nowrap;
}
.app-sidebar.collapsed .nav-label {
  opacity: 0;
  width: 0; /* 配合overflow:hidden防止文字换行挤压图标 */
}
```

### 1.2 导航分组与折叠箭头

```css
.nav-group-header {
  height: 32px; padding: 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; font-weight: 600; color: var(--text-tertiary);
  text-transform: uppercase;
  cursor: pointer;
}
.nav-group-toggle {
  font-size: 10px;
  transition: transform var(--duration-base) var(--ease-standard);
}
.nav-group.collapsed .nav-group-toggle { transform: rotate(-90deg); }
.nav-group-items {
  overflow: hidden;
  max-height: 1000px;
  transition: max-height var(--duration-slow) var(--ease-standard);
}
.nav-group.collapsed .nav-group-items { max-height: 0; }
```

### 1.3 导航项三态（默认/悬浮/激活）

```css
.nav-item {
  height: 40px; padding: 0 16px;
  display: flex; align-items: center; gap: 12px;
  font-size: 14px; color: var(--text-secondary);
  border-radius: var(--radius-md);
  margin: 2px 8px;
  position: relative;
  transition: all var(--duration-fast) var(--ease-standard);
}
.nav-item:hover {
  background: var(--color-background-secondary);
  color: var(--text-primary);
}
.nav-item.active {
  background: var(--color-info-bg);
  color: var(--color-info-text);
  font-weight: 500;
}
.nav-item.active::before {
  content: '';
  position: absolute; left: -8px; top: 8px; bottom: 8px;
  width: 3px; border-radius: var(--radius-full);
  background: var(--color-info-text);
}
.nav-item-icon { font-size: 16px; width: 20px; flex-shrink: 0; text-align: center; }
```

### 1.4 导航项未读/告警角标

```css
.nav-item-badge {
  margin-left: auto;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-danger-dot); color: white;
  font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
/* 折叠态时角标移动到图标右上角，变成6px小红点（不显示数字） */
.app-sidebar.collapsed .nav-item-badge {
  position: absolute; top: 6px; right: 6px;
  width: 6px; height: 6px; min-width: 0; padding: 0;
  font-size: 0;
}
```

### 1.5 折叠态的Tooltip

```css
/* 折叠态下，hover导航项显示完整名称tooltip */
.app-sidebar.collapsed .nav-item:hover::after {
  content: attr(data-label);
  position: absolute; left: calc(100% + 8px); top: 50%;
  transform: translateY(-50%);
  background: var(--text-primary); color: white;
  padding: 4px 10px; border-radius: var(--radius-sm);
  font-size: 12px; white-space: nowrap;
  box-shadow: var(--shadow-dropdown);
  animation: tooltip-in 120ms var(--ease-decelerate);
  z-index: 100;
}
@keyframes tooltip-in {
  from { opacity: 0; transform: translateY(-50%) translateX(-4px); }
  to   { opacity: 1; transform: translateY(-50%) translateX(0); }
}
```

### 1.6 折叠按钮

```css
.sidebar-collapse-btn {
  height: 32px; margin: 8px;
  border-radius: var(--radius-md);
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--color-border-tertiary);
  color: var(--text-tertiary);
  transition: all var(--duration-fast);
}
.sidebar-collapse-btn:hover {
  background: var(--color-background-secondary);
  color: var(--text-primary);
}
.sidebar-collapse-btn .icon {
  transition: transform var(--duration-slow) var(--ease-standard);
}
.app-sidebar.collapsed .sidebar-collapse-btn .icon {
  transform: rotate(180deg);
}
```

---

## 二、顶部栏（TopBar）

### 2.1 容器与三区布局

```css
.app-topbar {
  height: 56px;
  display: flex; align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-border-tertiary);
  gap: 16px;
}
.topbar-left { display: flex; align-items: center; gap: 12px; flex: 1; }
.topbar-right { display: flex; align-items: center; gap: 8px; }
```

### 2.2 面包屑

```css
.breadcrumb {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px;
}
.breadcrumb-item { color: var(--text-tertiary); }
.breadcrumb-item.current { color: var(--text-primary); font-weight: 500; }
.breadcrumb-item:not(.current):hover {
  color: var(--color-info-text); cursor: pointer;
}
.breadcrumb-separator { color: var(--text-placeholder); font-size: 11px; }
```

### 2.3 全局搜索触发按钮（非Ctrl+K时的入口）

```css
.global-search-trigger {
  height: 32px; width: 240px; padding: 0 12px;
  border-radius: var(--radius-md);
  background: var(--color-background-secondary);
  display: flex; align-items: center; gap: 8px;
  color: var(--text-tertiary); font-size: 13px;
  cursor: pointer;
  transition: all var(--duration-fast);
}
.global-search-trigger:hover {
  background: var(--color-background-primary);
  border: 1px solid var(--color-border-tertiary);
}
.global-search-trigger .kbd-hint {
  margin-left: auto;
  font-size: 11px; padding: 1px 5px;
  border: 1px solid var(--color-border-tertiary);
  border-radius: var(--radius-sm);
}
```

### 2.4 顶部栏图标按钮组（通知/语言/用户）

```css
.topbar-icon-btn {
  width: 36px; height: 36px;
  border-radius: var(--radius-md);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: var(--text-secondary);
  transition: background-color var(--duration-fast);
}
.topbar-icon-btn:hover { background: var(--color-background-secondary); }
```

### 2.5 离线/同步状态指示器

```css
.sync-status-indicator {
  height: 28px; padding: 0 10px;
  border-radius: var(--radius-full);
  display: flex; align-items: center; gap: 6px;
  font-size: 12px;
}
/* 在线-已同步 */
.sync-status-indicator.synced {
  background: var(--color-success-bg); color: var(--color-success-text);
}
.sync-status-indicator.synced .status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-success-dot);
}
/* 同步中 */
.sync-status-indicator.syncing {
  background: var(--color-info-bg); color: var(--color-info-text);
}
.sync-status-indicator.syncing .status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-info-text);
  animation: live-blink 1s ease-in-out infinite; /* 复用第三篇实时标记动效 */
}
/* 离线 */
.sync-status-indicator.offline {
  background: var(--color-warning-bg); color: var(--color-warning-text);
}
/* 点击离线指示器显示: "X条记录待同步" tooltip */
```

---

## 三、模块内Tab导航

> 区别于客户详情页的内容Tab（第一篇已定义underline样式），
> 这里定义"页面级Tab"——如催收中心的"工作台/台账/承诺/争议"四个子页面切换。

### 3.1 Pill样式Tab（用于页面级切换，视觉权重高于内容Tab）

```css
.page-tabs {
  display: flex; gap: 4px;
  padding: 4px;
  background: var(--color-background-secondary);
  border-radius: var(--radius-md);
  width: fit-content;
}
.page-tab {
  height: 32px; padding: 0 16px;
  border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 500;
  color: var(--text-secondary);
  display: flex; align-items: center; gap: 6px;
  cursor: pointer;
  transition: color var(--duration-fast);
  position: relative; z-index: 1;
}
.page-tab.active {
  color: var(--color-info-text);
}
/* 滑动指示器（与第三篇formulation-mode-tabs相同模式） */
.page-tabs .active-pill {
  position: absolute;
  height: 32px;
  background: var(--color-background-primary);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-card);
  transition: transform var(--duration-base) var(--ease-standard),
              width var(--duration-base) var(--ease-standard);
  z-index: 0;
}
.page-tab .tab-count {
  font-size: 11px; padding: 0 5px; height: 16px;
  border-radius: var(--radius-full);
  background: var(--color-background-secondary);
  display: flex; align-items: center;
}
.page-tab.active .tab-count {
  background: var(--color-info-bg);
}
```

---

## 四、看板视图（Kanban）

### 4.1 列容器

```css
.kanban-board {
  display: flex; gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  height: 100%;
}
.kanban-column {
  width: 280px; flex-shrink: 0;
  display: flex; flex-direction: column;
  background: var(--color-background-secondary);
  border-radius: var(--radius-lg);
  max-height: 100%;
}
.kanban-column-header {
  padding: 12px 14px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px; font-weight: 600;
}
.kanban-column-count {
  font-size: 12px; color: var(--text-tertiary);
  background: var(--color-background-primary);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}
.kanban-column-body {
  flex: 1; overflow-y: auto;
  padding: 0 8px 8px;
  display: flex; flex-direction: column; gap: 8px;
}
```

### 4.2 列头颜色按风险等级区分（CRM分级看板）

```css
.kanban-column-header.level-none  { border-top: 3px solid var(--color-success-dot); }
.kanban-column-header.level-low   { border-top: 3px solid var(--color-info-text); }
.kanban-column-header.level-mid   { border-top: 3px solid var(--color-warning-dot); }
.kanban-column-header.level-high  { border-top: 3px solid var(--color-danger-dot); }
.kanban-column { border-radius: var(--radius-lg); overflow: hidden; }
```

### 4.3 卡片拖拽态

```css
.kanban-card {
  background: var(--color-background-primary);
  border-radius: var(--radius-md);
  padding: 12px;
  box-shadow: var(--shadow-card);
  cursor: grab;
  transition: box-shadow var(--duration-fast), transform var(--duration-fast);
}
.kanban-card:active { cursor: grabbing; }

/* 拖拽中的卡片本体 */
.kanban-card.dragging {
  opacity: 0.4;
}
/* 跟随鼠标的拖拽预览(ghost) */
.kanban-card.drag-ghost {
  box-shadow: var(--shadow-dropdown), 0 8px 24px rgba(0,0,0,0.15);
  transform: scale(1.03) rotate(1deg);
  cursor: grabbing;
}
```

### 4.4 拖放目标区指示

```css
.kanban-column-body.drag-over {
  background: var(--color-info-bg);
  border-radius: var(--radius-md);
}
/* 占位符: 显示卡片将放置的位置 */
.kanban-drop-placeholder {
  height: 0;
  border: 2px dashed var(--color-info-border);
  border-radius: var(--radius-md);
  transition: height var(--duration-fast) var(--ease-standard);
}
.kanban-drop-placeholder.active {
  height: 64px; /* 等同于一张卡片的大致高度 */
}
```

### 4.5 卡片内容（客户分级看板示例）

```css
.kanban-card-title { font-size: 13px; font-weight: 600; }
.kanban-card-meta {
  display: flex; justify-content: space-between;
  margin-top: 8px; font-size: 12px; color: var(--text-tertiary);
}
.kanban-card-amount {
  font-size: 14px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-danger-text); /* 逾期金额 */
}
```

### 4.6 跨列移动后的成功反馈

```css
@keyframes kanban-card-landed {
  0%   { transform: scale(1.05); }
  100% { transform: scale(1); }
}
.kanban-card.just-moved {
  animation: kanban-card-landed 200ms var(--ease-standard);
}
/* 移动后顶部短暂出现细的高亮边框，800ms后淡出 */
.kanban-card.just-moved::before {
  content: '';
  position: absolute; inset: -1px;
  border: 1.5px solid var(--color-info-text);
  border-radius: var(--radius-md);
  opacity: 1;
  animation: highlight-fade 800ms ease-out forwards;
}
@keyframes highlight-fade {
  to { opacity: 0; }
}
```

---

## 五、表格内联编辑（双击编辑单元格）

> 适用场景：催收台账中快速修改"下次跟进日期"，库存表中快速调整"安全库存"等，
> 不需要打开完整编辑Modal的轻量场景。

### 5.1 单元格三态

```css
.editable-cell {
  height: 100%; padding: 0 12px;
  display: flex; align-items: center;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background-color var(--duration-fast);
}
.editable-cell:hover {
  background: var(--color-background-secondary);
}
.editable-cell:hover::after {
  content: '✎';
  margin-left: 6px;
  font-size: 11px; color: var(--text-tertiary);
}
```

### 5.2 编辑态（双击触发）

```css
.editable-cell.editing {
  padding: 0; /* input自带padding */
  background: var(--color-background-primary);
}
.editable-cell.editing input {
  width: 100%; height: 100%;
  border: 1.5px solid var(--color-info-text);
  border-radius: var(--radius-sm);
  padding: 0 11px; /* 12-1border */
  font-size: 14px;
  box-shadow: var(--shadow-focus);
}
/* 进入编辑态：瞬时切换，无动效（用户已经做出明确动作，不需要过渡缓冲） */
```

### 5.3 保存反馈（Enter确认或失焦自动保存）

```css
@keyframes cell-save-flash {
  0%   { background: var(--color-success-bg); }
  100% { background: transparent; }
}
.editable-cell.just-saved {
  animation: cell-save-flash 600ms ease-out;
}
/* 保存失败 */
.editable-cell.save-error {
  background: var(--color-danger-bg);
}
.editable-cell.save-error::after {
  content: '保存失败，点击重试';
  position: absolute; top: 100%; left: 0;
  font-size: 11px; color: var(--color-danger-text);
  background: var(--color-background-primary);
  padding: 2px 6px; border-radius: var(--radius-sm);
  box-shadow: var(--shadow-dropdown);
  white-space: nowrap;
}
```

### 5.4 Esc取消编辑的视觉反馈

```css
@keyframes cell-cancel-shake {
  0%, 100% { transform: translateX(0); }
  25%  { transform: translateX(-2px); }
  75%  { transform: translateX(2px); }
}
.editable-cell.cancelled { animation: cell-cancel-shake 200ms; }
```

---

## 六、批量操作工具栏

### 6.1 容器（吸顶，选中行后从上方滑入）

```css
.bulk-action-bar {
  height: 48px; padding: 0 16px;
  display: flex; align-items: center; gap: 12px;
  background: var(--color-info-bg);
  border-bottom: 1px solid var(--color-info-border);
  position: sticky; top: 0; z-index: 10;
  transform: translateY(-100%);
  transition: transform var(--duration-base) var(--ease-decelerate);
}
.bulk-action-bar.visible {
  transform: translateY(0);
}
```

### 6.2 选中计数与操作按钮

```css
.bulk-selection-count {
  font-size: 13px; font-weight: 600; color: var(--color-info-text);
  display: flex; align-items: center; gap: 6px;
}
.bulk-selection-count .clear-btn {
  font-size: 12px; color: var(--text-tertiary);
  text-decoration: underline; cursor: pointer;
}
.bulk-action-divider {
  width: 1px; height: 20px; background: var(--color-info-border);
}
.bulk-action-btn {
  height: 32px; padding: 0 12px;
  border-radius: var(--radius-md);
  background: var(--color-background-primary);
  border: 1px solid var(--color-border-tertiary);
  font-size: 13px;
  display: flex; align-items: center; gap: 6px;
  transition: all var(--duration-fast);
}
.bulk-action-btn:hover {
  border-color: var(--color-info-border);
}
.bulk-action-btn.danger {
  color: var(--color-danger-text);
}
.bulk-action-btn.danger:hover {
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
}
```

### 6.3 批量操作进度反馈（处理多条记录时）

```css
.bulk-progress-toast {
  /* 复用Toast容器，但内容包含进度条 */
}
.bulk-progress-bar-track {
  height: 4px; border-radius: var(--radius-full);
  background: var(--color-background-secondary);
  margin-top: 6px;
}
.bulk-progress-bar-fill {
  height: 100%; border-radius: var(--radius-full);
  background: var(--color-info-text);
  transition: width 200ms linear;
}
/* 文案: "正在处理 12/32 个客户..." */
/* 完成后: success Toast "已成功转移 32 个客户" */
/* 部分失败: warning Toast "30 个成功，2 个失败" + [查看详情] */
```

---

## 七、多选标签输入框（Tag Input）

### 7.1 容器（用于客户标签、产品分类多选）

```css
.tag-input-container {
  min-height: 36px; padding: 4px 8px;
  border: 1px solid var(--color-border-tertiary);
  border-radius: var(--radius-sm);
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.tag-input-container:focus-within {
  border-color: var(--color-info-text);
  box-shadow: var(--shadow-focus);
}
```

### 7.2 已选标签

```css
.tag-chip {
  height: 24px; padding: 0 8px 0 10px;
  border-radius: var(--radius-sm);
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px;
  /* 颜色按标签类型从预设色板分配，复用语义色背景但允许自定义 */
}
.tag-chip .tag-remove {
  font-size: 12px; opacity: 0.5;
  transition: opacity var(--duration-fast);
}
.tag-chip .tag-remove:hover { opacity: 1; }

/* 标签移除动效 */
@keyframes tag-remove {
  to { opacity: 0; transform: scale(0.8); width: 0; padding: 0; margin: 0; }
}
.tag-chip.removing { animation: tag-remove 150ms ease-in forwards; }
```

### 7.3 输入区与建议下拉

```css
.tag-input-field {
  flex: 1; min-width: 60px; height: 24px;
  border: none; outline: none;
  font-size: 13px; background: transparent;
}
.tag-suggestion-panel {
  /* 复用 .dropdown-panel 样式 */
}
.tag-suggestion-item.create-new {
  color: var(--color-info-text);
  font-weight: 500;
}
.tag-suggestion-item.create-new::before {
  content: '+ 新建标签 ';
  color: var(--text-tertiary);
}
```

---

## 八、数量+单位组合输入

> 适用：订单明细数量列、BOM用量列、调整数量列。

```css
.quantity-unit-input {
  display: flex; height: 32px;
  border: 1px solid var(--color-border-tertiary);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.quantity-unit-input:focus-within {
  border-color: var(--color-info-text);
  box-shadow: var(--shadow-focus);
}
.quantity-unit-input input {
  flex: 1; border: none; outline: none;
  text-align: right; padding: 0 8px;
  font-size: 14px; font-variant-numeric: tabular-nums;
  min-width: 0; /* 允许收缩 */
}
.quantity-unit-input .unit-select {
  flex-shrink: 0; width: 56px;
  border: none; border-left: 1px solid var(--color-border-tertiary);
  background: var(--color-background-secondary);
  font-size: 12px; color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
}
/* 单位不可编辑场景(继承Product Master定义)：unit-select变为纯文字标签 */
.quantity-unit-input .unit-label {
  flex-shrink: 0; padding: 0 10px;
  background: var(--color-background-secondary);
  border-left: 1px solid var(--color-border-tertiary);
  display: flex; align-items: center;
  font-size: 12px; color: var(--text-tertiary);
}
```

---

## 九、汇率锁定显示组件

> 适用：订单创建时显示锁定汇率，财务分析中显示折算说明。

```css
.exchange-rate-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px;
  border-radius: var(--radius-md);
  background: var(--color-background-secondary);
  font-size: 12px; font-variant-numeric: tabular-nums;
}
.exchange-rate-chip .lock-icon {
  font-size: 11px; color: var(--text-tertiary);
}
.exchange-rate-chip.editable {
  cursor: pointer;
  border: 1px dashed var(--color-border-tertiary);
}
.exchange-rate-chip.editable:hover {
  border-color: var(--color-info-border);
  background: var(--color-info-bg);
}
/* 文案: 🔒 1 CNY = 3,400 VND  (锁定于 2026-06-11) */
```

### 9.1 手动覆盖汇率时的差异提示

```css
.exchange-rate-override-hint {
  font-size: 11px; color: var(--color-warning-text);
  margin-top: 4px;
}
/* "当前市场汇率 3,420，与锁定汇率相差 0.6%" */
```

---

## 十、开关（Toggle）与单选组（Radio Group）

### 10.1 Toggle Switch

```css
.toggle-switch {
  width: 36px; height: 20px;
  border-radius: var(--radius-full);
  background: var(--color-border-tertiary);
  position: relative;
  cursor: pointer;
  transition: background-color var(--duration-base) var(--ease-standard);
}
.toggle-switch.on {
  background: var(--color-info-text);
}
.toggle-switch::after {
  content: '';
  position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: white;
  box-shadow: var(--shadow-card);
  transition: transform var(--duration-base) var(--ease-standard);
}
.toggle-switch.on::after {
  transform: translateX(16px);
}
/* 危险开关(如自动止货)用danger色 */
.toggle-switch.danger.on {
  background: var(--color-danger-dot);
}
```

### 10.2 Radio Group（卡片式，用于"配方模式"等少选项场景的替代方案）

```css
.radio-card-group {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.radio-card {
  padding: 12px;
  border: 1.5px solid var(--color-border-tertiary);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.radio-card:hover { border-color: var(--color-info-border); }
.radio-card.selected {
  border-color: var(--color-info-text);
  background: var(--color-info-bg);
}
.radio-card-icon { font-size: 18px; margin-bottom: 6px; }
.radio-card-title { font-size: 13px; font-weight: 500; }
.radio-card-desc { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
```

---

## 十一、用户头像与下拉菜单

### 11.1 头像

```css
.user-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: var(--color-info-text);
  color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600;
  flex-shrink: 0;
}
/* 显示姓名首字，越南文姓名取拉丁字母首字母 */
```

### 11.2 用户菜单面板

```css
.user-menu-panel {
  width: 220px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-dropdown);
  overflow: hidden;
}
.user-menu-header {
  padding: 14px;
  display: flex; align-items: center; gap: 10px;
  border-bottom: 1px solid var(--color-border-tertiary);
}
.user-menu-name { font-size: 14px; font-weight: 600; }
.user-menu-role { font-size: 12px; color: var(--text-tertiary); }
.user-menu-item {
  height: 40px; padding: 0 14px;
  display: flex; align-items: center; gap: 10px;
  font-size: 13px;
  transition: background-color var(--duration-fast);
}
.user-menu-item:hover { background: var(--color-background-secondary); }
.user-menu-item.danger { color: var(--color-danger-text); }
.user-menu-divider {
  height: 1px; background: var(--color-border-tertiary); margin: 4px 0;
}
```

### 11.3 语言/经销商切换器（嵌套子菜单）

```css
.user-menu-item.has-submenu {
  justify-content: space-between;
}
.user-menu-item.has-submenu::after {
  content: '›'; color: var(--text-tertiary);
}
.user-menu-submenu {
  position: absolute; left: calc(100% + 4px); top: 0;
  /* 与cascader-column相同的滑入动效 */
}
```

---

## 十二、AI助手对话面板

### 12.1 面板容器（右侧滑出）

```css
.ai-assistant-panel {
  position: fixed; right: 0; top: 56px; bottom: 0;
  width: 380px;
  background: var(--color-background-primary);
  border-left: 1px solid var(--color-border-tertiary);
  display: flex; flex-direction: column;
  transform: translateX(100%);
  transition: transform var(--duration-slow) var(--ease-standard);
}
.ai-assistant-panel.open { transform: translateX(0); }
```

### 12.2 能力卡片（首次打开/空状态时显示）

```css
.ai-capability-card {
  padding: 12px;
  border: 1px solid var(--color-border-tertiary);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  cursor: pointer;
  transition: all var(--duration-fast);
}
.ai-capability-card:hover {
  border-color: var(--color-info-border);
  background: var(--color-info-bg);
}
.ai-capability-card .capability-icon { font-size: 16px; margin-bottom: 4px; }
.ai-capability-card .capability-example {
  font-size: 12px; color: var(--text-tertiary); margin-top: 2px;
}
```

### 12.3 对话气泡

```css
.chat-message {
  max-width: 85%;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  font-size: 13px; line-height: 20px;
  margin-bottom: 8px;
}
.chat-message.user {
  align-self: flex-end;
  background: var(--color-info-text);
  color: white;
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
}
.chat-message.assistant {
  align-self: flex-start;
  background: var(--color-background-secondary);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm);
}
/* 数据查询类回复，附加"数据来源"标注 */
.chat-message.assistant .data-source-tag {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-tertiary);
  margin-top: 6px; padding-top: 6px;
  border-top: 0.5px solid var(--color-border-tertiary);
}
.chat-message.assistant .data-source-tag::before {
  content: '📊'; font-size: 11px;
}
/* "基于实时系统数据" vs "AI生成内容，请核实" 两种标注 */
```

### 12.4 输入区与发送状态

```css
.ai-chat-input-area {
  padding: 12px;
  border-top: 1px solid var(--color-border-tertiary);
  display: flex; gap: 8px; align-items: flex-end;
}
.ai-chat-textarea {
  flex: 1; max-height: 120px;
  border: 1px solid var(--color-border-tertiary);
  border-radius: var(--radius-md);
  padding: 8px 12px; font-size: 13px;
  resize: none;
}
.ai-chat-send-btn {
  width: 36px; height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-info-text); color: white;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--duration-fast);
}
.ai-chat-send-btn:disabled {
  background: var(--color-border-tertiary);
  cursor: not-allowed;
}
```

### 12.5 思考中状态（三点跳动）

```css
.ai-thinking-indicator {
  display: flex; gap: 4px; padding: 10px 12px;
}
.ai-thinking-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-tertiary);
  animation: thinking-bounce 1.2s ease-in-out infinite;
}
.ai-thinking-dot:nth-child(2) { animation-delay: 0.15s; }
.ai-thinking-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes thinking-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}
```

---

## 十三、打印预览布局

### 13.1 预览容器（模拟A4纸张）

```css
.print-preview-container {
  background: var(--color-background-secondary);
  padding: 24px;
  display: flex; justify-content: center;
}
.print-page {
  width: 210mm; min-height: 297mm; /* A4 */
  background: white;
  box-shadow: var(--shadow-dropdown);
  padding: 20mm;
  color: #1a1a1a; /* 打印用深色，不用CSS变量(打印时变量可能丢失) */
}
.print-page.a5 {
  width: 148mm; min-height: 210mm;
}
```

### 13.2 打印头部（公司信息+Logo）

```css
.print-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  border-bottom: 2px solid #1a1a1a;
  padding-bottom: 12px; margin-bottom: 16px;
}
.print-logo { height: 40px; }
.print-doc-title {
  font-size: 20px; font-weight: 700; text-align: right;
}
.print-doc-no { font-size: 12px; color: #666; text-align: right; }
```

### 13.3 打印操作栏（屏幕上显示，打印时隐藏）

```css
.print-toolbar {
  position: sticky; top: 0; z-index: 10;
  height: 48px; padding: 0 16px;
  display: flex; align-items: center; gap: 8px; justify-content: flex-end;
  background: var(--color-background-primary);
  border-bottom: 1px solid var(--color-border-tertiary);
}
@media print {
  .print-toolbar { display: none; }
  .print-preview-container { padding: 0; background: white; }
  .print-page { box-shadow: none; width: 100%; min-height: auto; }
}
```

### 13.4 语言切换Tab（中文/越南文双语模板）

```css
.print-lang-toggle {
  /* 复用 .page-tabs 的pill样式，仅两个选项: 中文 / Tiếng Việt */
}
```

### 13.5 签字栏

```css
.print-signature-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin-top: 40px;
  padding-top: 12px;
}
.print-signature-cell {
  border-top: 1px solid #999;
  padding-top: 8px;
  font-size: 12px; text-align: center; color: #666;
}
/* 三栏: 制单人 / 审核人 / 客户签收 */
```

---

## 十四、错误/空状态/404页面

### 14.1 ErrorBoundary fallback（模块级，区别于全局404）

```css
.module-error-fallback {
  height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px;
  padding: 40px;
}
.module-error-icon {
  font-size: 40px; color: var(--text-placeholder);
}
.module-error-title { font-size: 16px; font-weight: 600; }
.module-error-desc { font-size: 13px; color: var(--text-tertiary); text-align: center; max-width: 320px; }
.module-error-actions { display: flex; gap: 8px; margin-top: 8px; }
/* [刷新此模块] [报告问题] 两个按钮 */
.module-error-detail-toggle {
  font-size: 11px; color: var(--text-placeholder);
  text-decoration: underline; cursor: pointer; margin-top: 8px;
}
/* 点击展开技术错误信息(仅管理员角色可见此选项) */
.module-error-stack {
  font-family: monospace; font-size: 11px;
  background: var(--color-background-secondary);
  padding: 12px; border-radius: var(--radius-md);
  max-width: 480px; overflow-x: auto;
  margin-top: 8px;
}
```

### 14.2 全局空状态插图容器

```css
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 48px 24px;
  gap: 12px;
}
.empty-state-illustration {
  width: 120px; height: 120px;
  /* 简单SVG图标占位，非照片插图，保持系统轻量 */
  color: var(--text-placeholder);
}
.empty-state-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
.empty-state-desc { font-size: 13px; color: var(--text-tertiary); text-align: center; }
.empty-state-actions { display: flex; gap: 8px; margin-top: 8px; }
```

---

## 十五、审计日志查看器（结构化Diff视图）

> 对应第一轮报告中"AuditLog.details改为JSON格式"的UI呈现。

### 15.1 日志条目容器

```css
.audit-log-entry {
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-tertiary);
  margin-bottom: 8px;
}
.audit-log-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px;
}
.audit-log-action-tag {
  height: 20px; padding: 0 8px;
  border-radius: var(--radius-sm);
  font-size: 11px; font-weight: 600;
}
/* CREATE: success-bg, UPDATE: info-bg, DELETE: danger-bg */
.audit-log-time { margin-left: auto; font-size: 11px; color: var(--text-tertiary); }
```

### 15.2 Diff展示（修改前后对比）

```css
.audit-diff-table {
  margin-top: 8px;
  font-size: 12px;
  width: 100%;
}
.audit-diff-row {
  display: grid;
  grid-template-columns: 100px 1fr 1fr;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 0.5px solid var(--color-border-tertiary);
}
.audit-diff-field { color: var(--text-tertiary); }
.audit-diff-before {
  color: var(--color-danger-text);
  text-decoration: line-through;
  background: var(--color-danger-bg);
  padding: 1px 4px; border-radius: var(--radius-sm);
}
.audit-diff-after {
  color: var(--color-success-text);
  background: var(--color-success-bg);
  padding: 1px 4px; border-radius: var(--radius-sm);
}
```

### 15.3 折叠/展开详情

```css
.audit-log-toggle {
  font-size: 11px; color: var(--color-info-text);
  cursor: pointer; margin-top: 6px;
}
/* 默认仅显示操作摘要"修改了3个字段"，点击展开完整diff表 */
```

---

## 十六、第五篇Token复用与新增汇总

| 控件 | 复用已有Token | 新增Token |
|------|--------------|----------|
| 侧边导航折叠 | `--duration-slow`宽度过渡 | tooltip-in动效、角标位置切换 |
| 顶部栏同步状态 | live-blink(第三篇) | — |
| 看板拖拽 | shadow-dropdown | drag-ghost变形、drop-placeholder高度过渡 |
| 内联编辑 | 四态输入框 | cell-save-flash、cell-cancel-shake |
| 批量工具栏 | Toast堆叠模式 | sticky滑入transform |
| Tag输入 | dropdown-panel | tag-remove收缩动效 |
| 数量单位输入 | tabular-nums | — |
| Toggle开关 | duration-base过渡 | — |
| AI对话面板 | 滑出面板(同侧边导航) | thinking-bounce三点动效 |
| 打印预览 | page-tabs | @media print专用规则集 |
| 审计Diff | 三色语义(success/danger) | — |

---

## 十七、五篇文档总体覆盖范围最终确认

```
壳层:     侧边导航 / 顶部栏 / 面包屑 / 页面级Tab           ← 第五篇
通用控件: Dropdown / DatePicker / 文件上传 / 级联选择      ← 第四篇
          Tag输入 / 数量单位输入 / 汇率显示 / Toggle/Radio  ← 第五篇
          Modal / Toast / 骨架屏 / 命令面板 / 通知中心      ← 第一~三篇
业务模块: CRM客户(360°详情/风险/公海)                      ← 第一篇
          销售订单(明细行/两步表单)                        ← 第二、三篇
          生产(BOM/工单进度)                              ← 第二篇
          仓储(库位树)                                     ← 第二篇
          采购(供应商对比)                                 ← 第二篇
          催收(跟进表单/看板)                              ← 第一、五篇
          易货(协议结算)                                   ← 第三篇
          财务(指标卡)                                     ← 第三篇
          调整中心(审批流)                                 ← 第三篇
          团队权限(权限矩阵)                               ← 第三篇
          RMA(状态时间线)                                  ← 第三篇
          样品/合同/资产                                   ← 第四篇
          AI助手                                          ← 第五篇
特殊场景: 打印预览 / 错误页/空状态 / 审计日志               ← 第五篇
```

**到此为止，从壳层到13个业务模块的核心交互、再到打印/错误/审计这些边缘场景，
整个系统的UI实现规范已经形成闭环。** 后续如有新页面，按"Token优先复用"原则，
绝大部分场景可以在五篇文档中找到可直接套用的模式。

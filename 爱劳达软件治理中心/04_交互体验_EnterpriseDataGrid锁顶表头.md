# 04. EnterpriseDataGrid.tsx 高级表格锁顶核对文档

**目标文件**：`f:\爱牢达\components\ui\EnterpriseDataGrid.tsx`
**修改位置**：`thead` 的 `tr` 标签 (约第 266 行)
**修改目的**：
弥补 `EnterpriseDataGrid` 缺失 Sticky 锁顶的遗漏，使得拥有成百上千行数据的业务表格向下滚动时体验更加人性化。

## 详细修改核对单

### 增强表头锁顶与不透明度控制
**原代码**：
```tsx
<tr className="bg-slate-50/80 dark:bg-slate-800/70">
```

**现已修改为** (添加了 sticky 悬停、加大了不透明度以防文字重叠，并追加了一点阴影增强层次感)：
```tsx
<tr className="sticky top-0 z-20 bg-slate-50/95 dark:bg-slate-800/95 shadow-sm">
```

---
> **结论**：结合 DataTable 的同步修改，现在整个 ERP 系统的核心表格都能顺滑滚动而不再丢失字段含义了。

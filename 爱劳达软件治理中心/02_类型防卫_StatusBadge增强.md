# 02. StatusBadge.tsx 未知类型防卫修复核对文档

**目标文件**：`f:\爱牢达\components\ui\StatusBadge.tsx`
**修改位置**：`normalizeStatus` 函数 (约第 9 行)
**修改目的**：
防范接口返回错误或异常数据（非字符串，如 null/undefined/数字）时，调用 `toLowerCase` 导致前端抛出渲染错误的致命缺陷。

## 详细修改核对单

### 拦截非字符串参数
**原代码**：
```typescript
const normalizeStatus = (status: string) => status.toLowerCase().replace(/\s+/g, '_');
```

**现已修改为** (增加强类型拦截)：
```typescript
const normalizeStatus = (status: any) => {
  if (typeof status !== 'string') return String(status || 'unknown');
  return status.toLowerCase().replace(/\s+/g, '_');
};
```

---
> **结论**：如果状态字段意外为空或者类型出错，徽章将安全地显示“unknown”，防止整页因为一个小徽章的渲染而崩溃。

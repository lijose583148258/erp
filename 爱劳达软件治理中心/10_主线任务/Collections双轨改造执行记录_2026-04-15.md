# Collections 双轨改造执行记录

- 日期：2026-04-15
- 模块：Collections / 回款中心
- 目标：把原来“指标 + 多块台账并列”的页面，收口成“左侧动作工作台 + 右侧主数据网格 + 下方异常区”的双轨入口。

## 一、当前改造结果

### 1. 状态层已补齐“选中逾期对象”
- `useCollectionCenter.ts` 新增了 `selectedOverdue` 与 `setSelectedOverdue`
- 当逾期数据刷新后，会自动把当前选中对象回绑到最新列表，避免动作区和右侧列表脱钩

### 2. 左侧动作工作台已拆出
- 新增 `CollectionActionWorkspace.tsx`
- 当前承担：
  - 同步逾期
  - 批量催收
  - 当前选中订单摘要
  - 催收提醒
  - 承诺付款
  - 发起争议

### 3. 右侧主网格已拆出
- 新增 `CollectionPrimaryGrid.tsx`
- 当前承担：
  - 逾期清单主表
  - 收款台账主表
  - 合同回款节点主表
  - 逾期对象选中态回显
  - 逾期行快捷动作

### 4. 主页面已完成双轨挂载
- `CollectionCenterView.tsx` 已改为：
  - 顶部总览
  - 左侧动作工作台
  - 右侧主数据网格
  - 下方承诺 / 争议 / 拦截 / 运行信息

## 二、当前验证结果

### 编译验证
- `tsc --noEmit`：通过
- `npm run build`：通过

### 全局浏览器验收
- `acceptance-audit-report.json` 中：
  - `route-collections` passed
  - `assert-collections` passed

这说明：
- 回款中心路由能进入
- 页面壳层没有被这轮双轨改造打坏

### Collections 专项浏览器验收
- 新增 `scripts/collections-browser-audit-v1.cjs`
- 当前专项目标：
  1. 进入回款中心
  2. 选中首条逾期单
  3. 提交承诺付款
  4. 读取 `/api/collections/promises` 回读
  5. 提交争议
  6. 读取 `/api/collections/disputes` 回读

### 当前专项结果
- `seed-login-state`：passed
- `open-collections`：failed
- 失败现象：页面停在“系统加载中...”，未进入真正的回款中心工作台

## 三、当前诚实判断

### 已完成的部分
- 结构改造已落地
- 双轨入口已挂载
- 编译与构建无阻塞
- 全局回归验收未发现回款中心路由退化

### 还没有拿到实点测闭环证据的部分
- 选中逾期行后的动作工作台联动
- 承诺付款提交后的浏览器级回读
- 争议提交后的浏览器级回读

### 当前最可能的真实根因
- 不是 Collections 代码编译坏了
- 更像是专项脚本的鉴权引导方式，和应用壳的初始化判断还没有完全对齐
- 所以当前问题应归类为：
  - “专项浏览器验收路径未收口”
  - 不是“Collections 双轨代码本身已证实失效”

## 四、下一步最值钱的处理顺序

1. 排查回款中心为什么在专项脚本里停在“系统加载中...”
2. 拿下“选中逾期 -> 承诺付款 -> API 回读”的第一条闭环
3. 再拿下“选中逾期 -> 发起争议 -> API 回读”的第二条闭环
4. 最后把专项脚本里的稳定动作回灌到总验收脚本

## 五、补充更新（2026-04-15 21:34）

### 本轮新增修复
- 清理了 `CollectionActionWorkspace.tsx` 活跃源码里的乱码文案
- 清理了 `CollectionPrimaryGrid.tsx` 活跃源码里的乱码文案
- 把 `collections-browser-audit-v1.cjs` 对齐到真实登录返回结构、真实本地存储键和真实 activeTab/hash 行为
- 给专项 API 回读补上了 `Authorization` 头

### 最新专项结果
- `seed-login-state` passed
- `open-collections` passed
- `select-first-overdue` passed
- `submit-promise-action` passed
- `verify-promise-readback` passed
- `submit-dispute-action` passed
- `verify-dispute-readback` passed

### 最新结论
- Collections 已拿到浏览器级真实闭环证据
- 当前不再属于“只有页面级证据”的模块
- 后续可以把 Collections 从 B 档提升到 A 档

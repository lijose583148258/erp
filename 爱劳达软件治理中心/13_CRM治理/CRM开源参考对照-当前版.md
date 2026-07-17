# CRM开源参考对照（当前版）

## 目的

这份文档不是为了“找一个像样的 CRM 名字”，而是为了把当前系统里的客户池治理，放到成熟开源项目的真实做法里对照一下，避免继续套空泛通用模板。

## 1. Odoo 的参考价值

Odoo 的 CRM 重点不是“一个大客户列表”，而是：

- 多销售团队
- 按规则自动分配线索
- 未分配线索单独查看
- 线索可以按评分、域、团队分发到具体销售
- 有经理视角去看未跟进线索

关键点：

- Sales Team 可以按区域、语言、公司等维度分组
- Assignment Rules / Domains 可以把线索自动分到指定团队或销售员
- Unassigned leads 会被单独列出，供经理处理

参考：

- [Odoo - Manage sales teams](https://www.odoo.com/documentation/19.0/applications/sales/crm/pipeline/manage_sales_teams.html)
- [Odoo - Assign leads based on scoring](https://www.odoo.com/documentation/14.0/applications/sales/crm/track_leads/lead_scoring.html)
- [Odoo - Unattended leads report](https://www.odoo.com/documentation/18.0/applications/sales/crm/track_leads/unattended_leads_report.html)

## 2. ERPNext 的参考价值

ERPNext 的核心不是“公海/私海”这个词，而是：

- Territory（区域/组织边界）
- Sales Person（销售员）
- Sales Team/Target Allocation
- Territorywise / Item Groupwise 的目标和归属

它的启发是：

- 先定义业务区域和组织边界
- 再定义销售归属
- 再做目标分配与绩效追踪

参考：

- [ERPNext - Sales Person Target Allocation](https://docs.erpnext.com/sales-person-target-allocation)

## 3. SuiteCRM 的参考价值

SuiteCRM 更像传统 CRM，但它证明了两件事：

- 记录可以被分配给某个用户或团队
- 记录可以在模块里流转、导入、导出、转派

SuiteCRM 的强项不在“智能分配”，而在：

- Lead / Opportunity / Case 的标准模块化
- 记录转派和团队协作
- List View / Import Wizard / Actions 的一致交互

参考：

- [SuiteCRM - Leads](https://8-x.docs.suitecrm.com/user/core-modules/leads/)
- [SuiteCRM - Opportunities](https://docs.suitecrm.com/user/core-modules/opportunities/)
- [SuiteCRM - Cases](https://8-x.docs.suitecrm.com/user/core-modules/cases/)

## 4. 对我们系统的直接启发

结合当前代码和这些开源项目，最合理的结构应该是：

### 4.1 业务线先行

- 内销 `direct`
- 分销 `channel`
- 管理层 `mixed`

### 4.2 池子分层

- 公海
- 内部池
- 私海

### 4.3 分配规则

- 规则分配到团队
- 再分配到销售员
- 经理可以处理未分配 / 超时 / 异常客户

### 4.4 经理视图

- 看未分配客户
- 看超时未跟进客户
- 看团队池和私海
- 看领取 / 回收 / 转派历史

## 5. 这次对当前方案的修正点

之前的 CRM 方案偏通用。  
现在加上开源参考之后，应该改成：

1. 不是先写“公海 / 私海”
2. 而是先写“内销 / 分销 / 管理层”
3. 再写“池子结构”
4. 再写“分配 / 回收 / 审计”
5. 最后写“经理工作台和智能化”

## 6. 结论

开源项目已经证明了这个方向：

- Odoo 证明了“团队 + 域 + 自动分配 + 未分配队列”
- ERPNext 证明了“组织区域 + 销售归属 + 目标分配”
- SuiteCRM 证明了“标准模块 + 转派 + 导入导出 + 协作流转”

所以我们这边不该只做一个普通的 CRM 页面，而应该把它做成：

**内销 / 分销业务分线下的客户池治理系统**

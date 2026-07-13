# 🚀 爱牢达 AI CRM + 工厂生产型 ERP 系统改进与补全方案书

**方案日期：** 2026年04月08日  
**适用系统：** 爱牢达 ERP V2.0  
**目标范围：** 越中美三国跨境贸易工厂  
**核心功能：** 回款追踪 + 生产管理 + 多国财务报表  
**部署方式：** 云端部署 + 单机使用

---

## 📋 执行摘要

### 🎯 现状评估

**系统优势（已完成）：**
- ✅ 完整的 React + TypeScript 前端（14个页面）
- ✅ 专业的 Express + Prisma 后端（20+ API）
- ✅ 智能化 AI 功能（表格识别、语音输入、智能填写）
- ✅ 基础 CRM 功能（客户、订单、样品、物流、RMA）
- ✅ 资产管理（包装物/容器流转）
- ✅ 审计日志系统
- ✅ 多语言支持（中英越三语）

**核心差距（需补全）：**
- ❌ 工厂生产管理模块（生产计划、工单、BOM、质检）
- ❌ 越中美三国财务报表系统
- ❌ 深度回款追踪系统（分期、催收、账龄分析）
- ❌ 多国公司名称管理
- ❌ 生产成本核算
- ❌ 云端部署方案

---

## 一、核心模块补全方案

### 1.1 回款追踪系统（核心优先级 P0）

#### 📊 业务需求分析

**痛点：**
1. 跨国贸易涉及多种货币和账期
2. 客户分布在越南、中国、美国，收款方式不同
3. 需要追踪每笔订单的回款进度
4. 需要及时识别逾期风险

**解决方案：**

##### 1.1.1 数据库扩展

```prisma
// 在现有 schema.prisma 基础上新增

// 收款记录表（增强版）
model PaymentRecord {
  id              Int       @id @default(autoincrement())
  orderId         Int       @map("order_id")
  order           Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  
  // 基础信息
  amount          Float                          // 收款金额
  currency        String    @default("CNY")      // 币种：CNY, USD, VND
  exchangeRate    Float?    @map("exchange_rate") // 汇率（相对CNY）
  amountCNY       Float     @map("amount_cny")   // 折算成人民币金额
  
  // 收款方式
  method          String                         // bank_transfer, cash, alipay, wechat, paypal, check
  bankAccount     String?   @map("bank_account") // 收款银行账户
  transactionNo   String?   @map("transaction_no") // 交易流水号
  
  // 付款方信息
  payerName       String?   @map("payer_name")   // 付款人姓名
  payerCompany    String?   @map("payer_company") // 付款公司
  payerCountry    String?   @map("payer_country") // 付款国家：CN, VN, US
  isProxy         Boolean   @default(false) @map("is_proxy") // 是否代付
  
  // 时间信息
  paymentDate     DateTime  @map("payment_date") // 收款日期
  confirmedDate   DateTime? @map("confirmed_date") // 确认日期
  
  // 状态管理
  status          String    @default("pending")  // pending, confirmed, rejected, cancelled
  verifiedBy      Int?      @map("verified_by")  // 核销人
  
  // 附件
  receiptUrl      String?   @map("receipt_url")  // 收款凭证图片
  
  // 备注
  note            String?
  
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([orderId])
  @@index([status])
  @@index([paymentDate])
  @@index([currency])
  @@map("payment_records")
}

// 账期计划表（分期收款）
model PaymentSchedule {
  id              Int       @id @default(autoincrement())
  orderId         Int       @map("order_id")
  order           Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  
  // 分期信息
  stage           String                         // 阶段：deposit(定金), progress(进度款), final(尾款)
  percentage      Float                          // 百分比（例如：30.0 表示30%）
  amount          Float                          // 应收金额
  currency        String    @default("CNY")
  
  // 计划时间
  plannedDate     DateTime  @map("planned_date") // 计划收款日期
  dueDate         DateTime  @map("due_date")     // 到期日期
  
  // 实际收款
  receivedAmount  Float     @default(0) @map("received_amount") // 已收金额
  receivedDate    DateTime? @map("received_date") // 实际收款日期
  
  // 状态
  status          String    @default("pending")  // pending, partial, completed, overdue
  overdueDays     Int       @default(0) @map("overdue_days") // 逾期天数
  
  // 备注
  note            String?
  
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([orderId])
  @@index([status])
  @@index([dueDate])
  @@map("payment_schedules")
}

// 催收记录表
model CollectionRecord {
  id              Int       @id @default(autoincrement())
  customerId      Int       @map("customer_id")
  customer        Customer  @relation(fields: [customerId], references: [id])
  orderId         Int?      @map("order_id")
  
  // 催收信息
  type            String                         // phone, email, visit, legal
  method          String                         // 催收方式详细说明
  content         String                         // 催收内容
  
  // 催收结果
  result          String?                        // 催收结果
  promiseDate     DateTime? @map("promise_date") // 承诺付款日期
  promiseAmount   Float?    @map("promise_amount") // 承诺金额
  
  // 执行人
  collectorId     Int       @map("collector_id")
  collector       User      @relation(fields: [collectorId], references: [id])
  
  // 时间
  collectionDate  DateTime  @map("collection_date") // 催收日期
  nextFollowUp    DateTime? @map("next_follow_up")  // 下次跟进日期
  
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([customerId])
  @@index([orderId])
  @@index([collectorId])
  @@index([collectionDate])
  @@map("collection_records")
}

// 账龄分析表（自动计算）
model AccountAgingSnapshot {
  id              Int       @id @default(autoincrement())
  customerId      Int       @map("customer_id")
  customer        Customer  @relation(fields: [customerId], references: [id])
  
  // 账龄分段（单位：天）
  current         Float     @default(0)          // 0-30天
  aging30         Float     @default(0) @map("aging_30")  // 31-60天
  aging60         Float     @default(0) @map("aging_60")  // 61-90天
  aging90         Float     @default(0) @map("aging_90")  // 91-120天
  aging120Plus    Float     @default(0) @map("aging_120_plus") // 120天以上
  
  totalOutstanding Float    @map("total_outstanding") // 总应收
  
  // 快照时间
  snapshotDate    DateTime  @map("snapshot_date")
  
  createdAt       DateTime  @default(now()) @map("created_at")

  @@index([customerId])
  @@index([snapshotDate])
  @@map("account_aging_snapshots")
}
```

##### 1.1.2 前端页面设计

**新增页面：**

1. **回款管理主页面** (`pages/PaymentTracking.tsx`)
   - 回款概览仪表板
   - 待收款列表（按客户/订单）
   - 账龄分析图表
   - 逾期预警

2. **收款录入页面** (`pages/PaymentEntry.tsx`)
   - 快速录入收款
   - 批量导入银行流水
   - AI 智能匹配订单
   - 收款凭证上传

3. **催收管理页面** (`pages/CollectionManagement.tsx`)
   - 催收任务列表
   - 催收历史记录
   - 智能催收提醒
   - 催收话术模板

**组件设计：**

```typescript
// components/PaymentDashboard.tsx
interface PaymentStats {
  totalOutstanding: number;      // 总应收
  receivedThisMonth: number;     // 本月已收
  overdueAmount: number;         // 逾期金额
  upcomingDue: number;           // 即将到期
  currencyBreakdown: {           // 币种分布
    CNY: number;
    USD: number;
    VND: number;
  };
}

// components/AgingAnalysisChart.tsx
// 账龄分析饼图/柱状图

// components/PaymentScheduleTimeline.tsx
// 收款计划时间轴
```

##### 1.1.3 后端 API 设计

```typescript
// backend/src/routes/payment.routes.ts
router.get('/api/payments/overview', getPaymentOverview);          // 回款概览
router.get('/api/payments/aging/:customerId', getAgingAnalysis);   // 账龄分析
router.post('/api/payments/record', createPaymentRecord);          // 录入收款
router.post('/api/payments/schedule', createPaymentSchedule);      // 创建账期计划
router.get('/api/payments/overdue', getOverdueList);               // 逾期列表
router.post('/api/payments/collection', createCollectionRecord);   // 催收记录
router.get('/api/payments/forecast', getPaymentForecast);          // 回款预测
```

##### 1.1.4 AI 智能功能

**智能匹配收款：**
```typescript
// services/paymentAI.service.ts

/**
 * 根据银行流水自动匹配订单
 * - 分析付款人名称、金额、时间
 * - 模糊匹配客户和订单
 * - 返回匹配建议和置信度
 */
async function matchBankStatementToOrder(
  statement: BankStatement
): Promise<OrderMatch[]> {
  // 1. 提取关键信息
  const { payer, amount, date, description } = statement;
  
  // 2. 模糊匹配客户
  const customers = await fuzzyMatchCustomer(payer);
  
  // 3. 匹配订单
  const orders = await matchOrders(customers, amount, date);
  
  // 4. 计算置信度
  return orders.map(order => ({
    order,
    confidence: calculateConfidence(order, statement),
    reason: explainMatch(order, statement)
  }));
}
```

**逾期预警：**
```typescript
// 每日自动任务：检查即将逾期的账款
async function checkOverdueWarnings() {
  const schedules = await prisma.paymentSchedule.findMany({
    where: {
      status: { in: ['pending', 'partial'] },
      dueDate: {
        lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7天内到期
      }
    },
    include: { order: { include: { customer: true } } }
  });
  
  // 发送预警通知
  for (const schedule of schedules) {
    await sendWarningNotification(schedule);
  }
}
```

---

### 1.2 工厂生产管理模块（优先级 P0）

#### 📦 业务需求分析

**痛点：**
1. 订单与生产脱节，无法实时了解生产进度
2. 缺少 BOM（物料清单）管理
3. 无法追踪原材料库存和采购
4. 质检流程不规范

**解决方案：**

##### 1.2.1 数据库扩展

```prisma
// 产品 BOM 表（物料清单）
model ProductBOM {
  id              Int       @id @default(autoincrement())
  productCode     String    @map("product_code")    // 产品编码
  productName     String    @map("product_name")    // 产品名称
  version         String    @default("1.0")         // BOM版本
  
  // 成品信息
  unit            String                            // 计量单位
  batchSize       Float     @map("batch_size")      // 标准批次数量
  
  // 状态
  status          String    @default("draft")       // draft, active, obsolete
  effectiveDate   DateTime? @map("effective_date")  // 生效日期
  
  // 材料清单
  materials       BOMMaterial[]
  
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([productCode, version])
  @@index([productCode])
  @@index([status])
  @@map("product_boms")
}

// BOM 材料明细
model BOMMaterial {
  id              Int       @id @default(autoincrement())
  bomId           Int       @map("bom_id")
  bom             ProductBOM @relation(fields: [bomId], references: [id], onDelete: Cascade)
  
  // 材料信息
  materialCode    String    @map("material_code")   // 物料编码
  materialName    String    @map("material_name")   // 物料名称
  specification   String?                           // 规格
  
  // 用量
  quantity        Float                             // 单位用量
  unit            String                            // 计量单位
  wastageRate     Float     @default(0) @map("wastage_rate") // 损耗率（%）
  
  // 供应商
  preferredSupplier String? @map("preferred_supplier")
  leadTimeDays    Int?      @map("lead_time_days")  // 采购周期
  
  createdAt       DateTime  @default(now()) @map("created_at")

  @@index([bomId])
  @@index([materialCode])
  @@map("bom_materials")
}

// 生产工单表
model ProductionOrder {
  id              Int       @id @default(autoincrement())
  workOrderNo     String    @unique @map("work_order_no") // 工单号
  
  // 关联销售订单
  salesOrderId    Int?      @map("sales_order_id")
  salesOrder      Order?    @relation(fields: [salesOrderId], references: [id])
  
  // 产品信息
  productCode     String    @map("product_code")
  productName     String    @map("product_name")
  bomVersion      String?   @map("bom_version")     // 使用的BOM版本
  
  // 数量
  plannedQty      Float     @map("planned_qty")     // 计划数量
  producedQty     Float     @default(0) @map("produced_qty") // 完成数量
  qualifiedQty    Float     @default(0) @map("qualified_qty") // 合格数量
  unit            String
  
  // 时间计划
  plannedStart    DateTime  @map("planned_start")   // 计划开始
  plannedEnd      DateTime  @map("planned_end")     // 计划完成
  actualStart     DateTime? @map("actual_start")    // 实际开始
  actualEnd       DateTime? @map("actual_end")      // 实际完成
  
  // 状态
  status          String    @default("pending")     // pending, in_progress, completed, cancelled
  priority        String    @default("normal")      // urgent, high, normal, low
  
  // 车间/产线
  workshop        String?                           // 车间
  productionLine  String?   @map("production_line") // 产线
  
  // 负责人
  supervisorId    Int?      @map("supervisor_id")
  supervisor      User?     @relation(fields: [supervisorId], references: [id])
  
  // 成本
  materialCost    Float     @default(0) @map("material_cost")  // 材料成本
  laborCost       Float     @default(0) @map("labor_cost")     // 人工成本
  overheadCost    Float     @default(0) @map("overhead_cost")  // 制造费用
  totalCost       Float     @default(0) @map("total_cost")
  
  // 关联
  materialRequisitions MaterialRequisition[]
  qualityInspections   QualityInspection[]
  
  note            String?
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([salesOrderId])
  @@index([status])
  @@index([priority])
  @@index([plannedStart])
  @@map("production_orders")
}

// 领料单表
model MaterialRequisition {
  id              Int       @id @default(autoincrement())
  requisitionNo   String    @unique @map("requisition_no")
  
  // 关联工单
  productionOrderId Int     @map("production_order_id")
  productionOrder   ProductionOrder @relation(fields: [productionOrderId], references: [id])
  
  // 领料信息
  materialCode    String    @map("material_code")
  materialName    String    @map("material_name")
  requestedQty    Float     @map("requested_qty")   // 申请数量
  issuedQty       Float     @default(0) @map("issued_qty") // 已发数量
  unit            String
  
  // 状态
  status          String    @default("pending")     // pending, partial, completed, cancelled
  
  // 申请人
  requestedBy     Int       @map("requested_by")
  requester       User      @relation(fields: [requestedBy], references: [id])
  
  // 时间
  requestDate     DateTime  @map("request_date")
  issuedDate      DateTime? @map("issued_date")
  
  note            String?
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([productionOrderId])
  @@index([status])
  @@map("material_requisitions")
}

// 质检记录表
model QualityInspection {
  id              Int       @id @default(autoincrement())
  inspectionNo    String    @unique @map("inspection_no")
  
  // 关联工单
  productionOrderId Int?    @map("production_order_id")
  productionOrder   ProductionOrder? @relation(fields: [productionOrderId], references: [id])
  
  // 检验类型
  type            String                            // incoming(来料), in_process(过程), final(成品)
  
  // 检验信息
  productName     String    @map("product_name")
  batchNo         String?   @map("batch_no")        // 批次号
  sampleSize      Int       @map("sample_size")     // 抽样数量
  
  // 检验结果
  qualifiedQty    Int       @map("qualified_qty")   // 合格数量
  rejectedQty     Int       @map("rejected_qty")    // 不合格数量
  defectTypes     String?   @map("defect_types")    // 缺陷类型（JSON）
  
  result          String                            // pass, fail, conditional
  conclusion      String?                           // 检验结论
  
  // 检验员
  inspectorId     Int       @map("inspector_id")
  inspector       User      @relation(fields: [inspectorId], references: [id])
  
  // 时间
  inspectionDate  DateTime  @map("inspection_date")
  
  // 附件
  reportUrl       String?   @map("report_url")      // 检验报告
  photoUrls       String?   @map("photo_urls")      // 照片（JSON数组）
  
  note            String?
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([productionOrderId])
  @@index([type])
  @@index([result])
  @@index([inspectionDate])
  @@map("quality_inspections")
}

// 库存表（原材料和成品）
model Inventory {
  id              Int       @id @default(autoincrement())
  
  // 物料信息
  itemCode        String    @map("item_code")
  itemName        String    @map("item_name")
  itemType        String    @map("item_type")       // material(原料), product(成品), semi(半成品)
  specification   String?
  
  // 库存信息
  warehouseLocation String  @map("warehouse_location") // 仓库位置
  quantity        Float     @default(0)
  unit            String
  
  // 安全库存
  safetyStock     Float?    @map("safety_stock")    // 安全库存
  reorderPoint    Float?    @map("reorder_point")   // 再订货点
  
  // 批次管理
  batchNo         String?   @map("batch_no")
  productionDate  DateTime? @map("production_date")
  expiryDate      DateTime? @map("expiry_date")
  
  // 成本
  unitCost        Float?    @map("unit_cost")       // 单位成本
  totalValue      Float?    @map("total_value")     // 总价值
  
  // 状态
  status          String    @default("normal")      // normal, reserved, quarantine
  
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([itemCode, warehouseLocation, batchNo])
  @@index([itemCode])
  @@index([itemType])
  @@index([status])
  @@map("inventory")
}

// 库存流水表
model InventoryTransaction {
  id              Int       @id @default(autoincrement())
  transactionNo   String    @unique @map("transaction_no")
  
  // 物料信息
  itemCode        String    @map("item_code")
  itemName        String    @map("item_name")
  
  // 交易类型
  type            String                            // in(入库), out(出库), adjust(调整), transfer(转移)
  subType         String?   @map("sub_type")        // purchase(采购), production(生产), sales(销售), return(退货)
  
  // 数量
  quantity        Float
  unit            String
  
  // 仓库
  fromWarehouse   String?   @map("from_warehouse")
  toWarehouse     String?   @map("to_warehouse")
  
  // 关联单据
  referenceType   String?   @map("reference_type")  // purchase_order, sales_order, production_order
  referenceNo     String?   @map("reference_no")
  
  // 成本
  unitCost        Float?    @map("unit_cost")
  totalCost       Float?    @map("total_cost")
  
  // 操作人
  operatorId      Int       @map("operator_id")
  operator        User      @relation(fields: [operatorId], references: [id])
  
  // 时间
  transactionDate DateTime  @map("transaction_date")
  
  note            String?
  createdAt       DateTime  @default(now()) @map("created_at")

  @@index([itemCode])
  @@index([type])
  @@index([transactionDate])
  @@index([operatorId])
  @@map("inventory_transactions")
}
```

##### 1.2.2 前端页面设计

**新增页面：**

1. **生产管理主页** (`pages/Production.tsx`)
   - 工单看板（Kanban视图）
   - 生产进度总览
   - 今日/本周生产计划
   - 产能利用率分析

2. **工单管理** (`pages/ProductionOrders.tsx`)
   - 工单列表
   - 工单创建/编辑
   - 工单详情（关联销售订单、BOM、领料、质检）
   - 工单状态流转

3. **BOM 管理** (`pages/BOMManagement.tsx`)
   - BOM 列表
   - BOM 创建/版本管理
   - 材料清单维护
   - BOM 复制/导入导出

4. **库存管理** (`pages/InventoryManagement.tsx`)
   - 库存总览
   - 库存预警
   - 库存盘点
   - 出入库记录

5. **质检管理** (`pages/QualityControl.tsx`)
   - 质检任务列表
   - 质检记录录入
   - 质检报告
   - 不合格品处理

---

### 1.3 越中美三国财务报表系统（优先级 P0）

#### 💰 业务需求分析

**痛点：**
1. 不同国家的会计准则不同
2. 需要支持多币种财务报表
3. 税务申报要求不同
4. 需要合并报表和分公司报表

**解决方案：**

##### 1.3.1 多公司架构设计

```prisma
// 公司主体表
model Company {
  id              Int       @id @default(autoincrement())
  
  // 基础信息
  code            String    @unique                 // 公司代码：CN001, VN001, US001
  legalName       String    @map("legal_name")      // 法定名称
  nameCN          String?   @map("name_cn")         // 中文名称
  nameEN          String?   @map("name_en")         // 英文名称
  nameVN          String?   @map("name_vn")         // 越南语名称
  
  // 注册信息
  country         String                            // CN, VN, US
  registrationNo  String    @map("registration_no") // 注册号/统一社会信用代码
  taxId           String?   @map("tax_id")          // 税号
  
  // 联系信息
  address         String?
  phone           String?
  email           String?
  
  // 会计设置
  accountingStandard String  @map("accounting_standard") // GAAP_CN, IFRS, GAAP_US, VAS
  fiscalYearStart    String  @map("fiscal_year_start")   // 会计年度开始月份：01, 04, 07, 10
  baseCurrency       String  @map("base_currency")       // 本位币：CNY, USD, VND
  
  // 税务设置
  vatRate         Float?    @map("vat_rate")        // 增值税率
  incomeTaxRate   Float?    @map("income_tax_rate") // 所得税率
  
  // 状态
  status          String    @default("active")      // active, suspended, closed
  isHeadquarter   Boolean   @default(false) @map("is_headquarter") // 是否总部
  parentCompanyId Int?      @map("parent_company_id")
  parentCompany   Company?  @relation("CompanyHierarchy", fields: [parentCompanyId], references: [id])
  subsidiaries    Company[] @relation("CompanyHierarchy")
  
  // 关联
  customers       Customer[]
  orders          Order[]
  accounts        ChartOfAccount[]
  journals        JournalEntry[]
  
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([country])
  @@index([status])
  @@map("companies")
}

// 会计科目表（支持多国标准）
model ChartOfAccount {
  id              Int       @id @default(autoincrement())
  companyId       Int       @map("company_id")
  company         Company   @relation(fields: [companyId], references: [id])
  
  // 科目信息
  accountCode     String    @map("account_code")    // 科目编码：1001, 2202
  accountName     String    @map("account_name")    // 科目名称
  accountNameEN   String?   @map("account_name_en")
  accountNameVN   String?   @map("account_name_vn")
  
  // 科目分类
  category        String                            // asset, liability, equity, revenue, expense
  subCategory     String?   @map("sub_category")    // current_asset, fixed_asset, etc.
  
  // 科目属性
  accountType     String    @map("account_type")    // balance_sheet, income_statement, cash_flow
  direction       String                            // debit, credit (借方/贷方)
  
  // 父级科目
  parentAccountId Int?      @map("parent_account_id")
  parentAccount   ChartOfAccount? @relation("AccountHierarchy", fields: [parentAccountId], references: [id])
  subAccounts     ChartOfAccount[] @relation("AccountHierarchy")
  
  // 辅助核算
  enableCustomer  Boolean   @default(false) @map("enable_customer")  // 客户辅助核算
  enableSupplier  Boolean   @default(false) @map("enable_supplier")  // 供应商辅助核算
  enableProject   Boolean   @default(false) @map("enable_project")   // 项目辅助核算
  enableDepartment Boolean  @default(false) @map("enable_department")// 部门辅助核算
  
  // 状态
  status          String    @default("active")      // active, inactive
  isSystemAccount Boolean   @default(false) @map("is_system_account") // 系统预设科目
  
  // 关联
  journalLines    JournalEntryLine[]
  
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([companyId, accountCode])
  @@index([companyId])
  @@index([category])
  @@index([accountType])
  @@map("chart_of_accounts")
}

// 会计分录表
model JournalEntry {
  id              Int       @id @default(autoincrement())
  companyId       Int       @map("company_id")
  company         Company   @relation(fields: [companyId], references: [id])
  
  // 凭证信息
  voucherNo       String    @map("voucher_no")      // 凭证号
  voucherType     String    @map("voucher_type")    // receipt(收), payment(付), transfer(转)
  voucherDate     DateTime  @map("voucher_date")    // 凭证日期
  period          String                            // 会计期间：2026-04
  
  // 摘要
  description     String
  
  // 金额
  totalDebit      Float     @map("total_debit")     // 借方总额
  totalCredit     Float     @map("total_credit")    // 贷方总额
  currency        String    @default("CNY")
  
  // 关联单据
  referenceType   String?   @map("reference_type")  // sales_order, purchase_order, payment
  referenceNo     String?   @map("reference_no")
  
  // 状态
  status          String    @default("draft")       // draft, posted, void
  postedDate      DateTime? @map("posted_date")     // 过账日期
  
  // 制单人和审核人
  preparedBy      Int       @map("prepared_by")
  preparer        User      @relation("PreparedEntries", fields: [preparedBy], references: [id])
  approvedBy      Int?      @map("approved_by")
  approver        User?     @relation("ApprovedEntries", fields: [approvedBy], references: [id])
  
  // 分录明细
  lines           JournalEntryLine[]
  
  note            String?
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([companyId, voucherNo])
  @@index([companyId])
  @@index([voucherDate])
  @@index([period])
  @@index([status])
  @@map("journal_entries")
}

// 会计分录明细
model JournalEntryLine {
  id              Int       @id @default(autoincrement())
  journalEntryId  Int       @map("journal_entry_id")
  journalEntry    JournalEntry @relation(fields: [journalEntryId], references: [id], onDelete: Cascade)
  
  // 科目
  accountId       Int       @map("account_id")
  account         ChartOfAccount @relation(fields: [accountId], references: [id])
  
  // 摘要
  description     String?
  
  // 借贷方向和金额
  debitAmount     Float     @default(0) @map("debit_amount")
  creditAmount    Float     @default(0) @map("credit_amount")
  
  // 辅助核算
  customerId      Int?      @map("customer_id")
  supplierId      Int?      @map("supplier_id")
  projectCode     String?   @map("project_code")
  departmentCode  String?   @map("department_code")
  
  createdAt       DateTime  @default(now()) @map("created_at")

  @@index([journalEntryId])
  @@index([accountId])
  @@map("journal_entry_lines")
}

// 财务报表配置（支持不同国家标准）
model FinancialReportTemplate {
  id              Int       @id @default(autoincrement())
  
  // 报表信息
  reportCode      String    @unique @map("report_code")
  reportName      String    @map("report_name")
  reportType      String    @map("report_type")    // balance_sheet, income_statement, cash_flow
  
  // 适用国家和标准
  country         String                            // CN, VN, US, ALL
  accountingStandard String  @map("accounting_standard") // GAAP_CN, IFRS, GAAP_US, VAS
  
  // 报表结构（JSON）
  templateStructure String  @map("template_structure") // JSON格式的报表结构
  
  // 公式配置（JSON）
  formulaConfig   String    @map("formula_config")  // 各项目的计算公式
  
  // 状态
  status          String    @default("active")
  isDefault       Boolean   @default(false) @map("is_default")
  
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([country])
  @@index([reportType])
  @@map("financial_report_templates")
}
```

##### 1.3.2 三国财务报表差异配置

**中国（GAAP_CN）：**
```typescript
// 资产负债表（中国准则）
const CN_BalanceSheetTemplate = {
  assets: {
    currentAssets: [
      '货币资金',
      '交易性金融资产',
      '应收票据',
      '应收账款',
      '预付款项',
      '其他应收款',
      '存货',
      '其他流动资产'
    ],
    nonCurrentAssets: [
      '长期投资',
      '固定资产',
      '无形资产',
      '长期待摊费用',
      '递延所得税资产'
    ]
  },
  liabilities: {
    currentLiabilities: [
      '短期借款',
      '应付票据',
      '应付账款',
      '预收款项',
      '应付职工薪酬',
      '应交税费',
      '其他应付款'
    ],
    nonCurrentLiabilities: [
      '长期借款',
      '长期应付款',
      '递延所得税负债'
    ]
  },
  equity: [
    '实收资本',
    '资本公积',
    '盈余公积',
    '未分配利润'
  ],
  vatRate: 13,  // 增值税率13%
  incomeTaxRate: 25  // 企业所得税率25%
};

// 利润表（中国准则）
const CN_IncomeStatementTemplate = {
  revenue: [
    '营业收入',
    '减：营业成本',
    '税金及附加',
    '销售费用',
    '管理费用',
    '研发费用',
    '财务费用'
  ],
  profit: [
    '加：其他收益',
    '投资收益',
    '公允价值变动收益',
    '资产处置收益'
  ],
  tax: [
    '减：所得税费用'
  ]
};
```

**越南（VAS）：**
```typescript
// 资产负债表（越南准则）
const VN_BalanceSheetTemplate = {
  assets: {
    currentAssets: [
      'Tiền và các khoản tương đương tiền',  // 现金及现金等价物
      'Phải thu khách hàng',                  // 应收账款
      'Hàng tồn kho',                        // 存货
      'Chi phí trả trước',                   // 预付费用
    ],
    fixedAssets: [
      'Tài sản cố định hữu hình',            // 有形固定资产
      'Tài sản cố định vô hình',             // 无形资产
    ]
  },
  liabilities: {
    currentLiabilities: [
      'Vay ngắn hạn',                        // 短期借款
      'Phải trả người bán',                  // 应付账款
      'Thuế và các khoản phải nộp',          // 应交税费
    ]
  },
  equity: [
    'Vốn chủ sở hữu',                        // 所有者权益
    'Lợi nhuận chưa phân phối'               // 未分配利润
  ],
  vatRate: 10,  // VAT 10%
  incomeTaxRate: 20  // 企业所得税 20%
};
```

**美国（GAAP_US）：**
```typescript
// Balance Sheet (US GAAP)
const US_BalanceSheetTemplate = {
  assets: {
    currentAssets: [
      'Cash and Cash Equivalents',
      'Accounts Receivable',
      'Inventory',
      'Prepaid Expenses',
      'Other Current Assets'
    ],
    nonCurrentAssets: [
      'Property, Plant and Equipment',
      'Intangible Assets',
      'Goodwill',
      'Other Long-term Assets'
    ]
  },
  liabilities: {
    currentLiabilities: [
      'Accounts Payable',
      'Accrued Expenses',
      'Current Portion of Long-term Debt',
      'Other Current Liabilities'
    ],
    longTermLiabilities: [
      'Long-term Debt',
      'Deferred Tax Liabilities',
      'Other Long-term Liabilities'
    ]
  },
  equity: [
    'Common Stock',
    'Additional Paid-in Capital',
    'Retained Earnings',
    'Accumulated Other Comprehensive Income'
  ],
  salesTaxRate: 0,  // 各州不同
  incomeTaxRate: 21  // Federal corporate tax rate 21%
};
```

##### 1.3.3 前端页面设计

**新增页面：**

1. **公司管理** (`pages/CompanyManagement.tsx`)
   - 公司列表（中国公司、越南公司、美国公司）
   - 公司信息维护
   - 会计准则配置
   - 科目表模板选择

2. **会计科目** (`pages/ChartOfAccounts.tsx`)
   - 科目树形结构
   - 科目新增/编辑
   - 科目启用/停用
   - 批量导入科目

3. **凭证管理** (`pages/JournalEntries.tsx`)
   - 凭证列表
   - 凭证制单
   - 凭证审核
   - 凭证查询

4. **财务报表** (`pages/FinancialReports.tsx`)
   - 资产负债表（三国版本切换）
   - 利润表（三国版本切换）
   - 现金流量表
   - 合并报表
   - 报表导出（Excel/PDF）

5. **多币种汇兑** (`pages/CurrencyExchange.tsx`)
   - 汇率维护（CNY/USD/VND）
   - 汇兑损益计算
   - 外币折算

---

## 二、AI 智能功能增强

### 2.1 智能收款匹配

```typescript
// services/intelligentPaymentMatching.ts

/**
 * AI 驱动的收款智能匹配
 * - 使用 NLP 分析银行流水描述
 * - 模糊匹配客户名称（中英越三语）
 * - 基于历史数据的机器学习预测
 */
interface BankStatement {
  transactionId: string;
  date: Date;
  payer: string;        // 付款方名称
  amount: number;
  currency: string;
  description: string;  // 交易描述
  bankAccount: string;
}

interface MatchResult {
  customer: Customer;
  orders: Order[];
  confidence: number;   // 0-100
  reasons: string[];    // 匹配依据
}

async function intelligentMatchPayment(
  statement: BankStatement
): Promise<MatchResult[]> {
  // 1. 提取关键词
  const keywords = extractKeywords(statement.description);
  
  // 2. 多语言模糊匹配客户
  const customerMatches = await fuzzyMatchCustomer({
    name: statement.payer,
    keywords: keywords,
    languages: ['zh', 'en', 'vi']
  });
  
  // 3. 匹配订单
  const results: MatchResult[] = [];
  for (const customer of customerMatches) {
    const orders = await findMatchingOrders(customer.id, {
      amount: statement.amount,
      currency: statement.currency,
      dateRange: [
        new Date(statement.date.getTime() - 30 * 24 * 60 * 60 * 1000),
        new Date(statement.date.getTime() + 7 * 24 * 60 * 60 * 1000)
      ]
    });
    
    results.push({
      customer,
      orders,
      confidence: calculateConfidence(customer, orders, statement),
      reasons: explainMatch(customer, orders, statement)
    });
  }
  
  // 4. 按置信度排序
  return results.sort((a, b) => b.confidence - a.confidence);
}
```

### 2.2 AI 生产排程优化

```typescript
// services/productionSchedulingAI.ts

/**
 * AI 驱动的生产排程
 * - 考虑设备产能、人员配置
 * - 优化交货期
 * - 最小化换线时间
 */
interface ProductionConstraints {
  workshops: Workshop[];
  productionLines: ProductionLine[];
  workOrders: ProductionOrder[];
  materialAvailability: MaterialStock[];
}

async function optimizeProductionSchedule(
  constraints: ProductionConstraints
): Promise<OptimizedSchedule> {
  // 使用遗传算法或启发式算法优化排程
  const schedule = await runOptimizationAlgorithm({
    objectives: [
      'minimize_makespan',      // 最小化总完工时间
      'maximize_utilization',   // 最大化设备利用率
      'minimize_tardiness'      // 最小化延期
    ],
    constraints: constraints
  });
  
  return schedule;
}
```

### 2.3 AI 财务异常检测

```typescript
// services/financialAnomalyDetection.ts

/**
 * AI 异常交易检测
 * - 检测可疑收款
 * - 识别异常支出
 * - 预警财务风险
 */
async function detectFinancialAnomalies(
  companyId: number,
  period: string
): Promise<Anomaly[]> {
  const journals = await getJournalEntries(companyId, period);
  
  const anomalies: Anomaly[] = [];
  
  for (const journal of journals) {
    // 1. 金额异常检测
    if (isAmountAnomaly(journal)) {
      anomalies.push({
        type: 'amount_anomaly',
        severity: 'high',
        journal: journal,
        reason: '金额显著偏离历史平均值'
      });
    }
    
    // 2. 科目组合异常
    if (isAccountCombinationUnusual(journal)) {
      anomalies.push({
        type: 'unusual_combination',
        severity: 'medium',
        journal: journal,
        reason: '科目组合不常见'
      });
    }
    
    // 3. 时间模式异常
    if (isTimingAnomaly(journal)) {
      anomalies.push({
        type: 'timing_anomaly',
        severity: 'low',
        journal: journal,
        reason: '发生时间异常'
      });
    }
  }
  
  return anomalies;
}
```

---

## 三、开源软件推荐

### 3.1 核心技术栈（已使用）

✅ **前端框架：**
- React 19.2.4 - 用户界面
- TypeScript 5.8.2 - 类型安全
- Vite 6.2.0 - 构建工具
- Tailwind CSS - 样式框架

✅ **后端框架：**
- Node.js 18+ - 运行环境
- Express.js - Web 框架
- Prisma ORM - 数据库 ORM
- SQLite（开发） / PostgreSQL（生产） - 数据库

### 3.2 推荐新增开源软件

#### 3.2.1 数据库和存储

**PostgreSQL 16+**（生产环境）
```bash
# 为什么选择 PostgreSQL：
- 完全免费开源
- 支持复杂查询和事务
- 优秀的并发性能
- 支持 JSON 字段（适合存储灵活数据）
- 丰富的扩展生态

# 迁移方式：
# 从 SQLite 迁移到 PostgreSQL
npx prisma db push --schema=./prisma/schema.prisma
```

**Redis 7+**（缓存层）
```bash
# 用途：
- 会话缓存
- API 响应缓存
- 实时数据缓存（如库存数量）
- 分布式锁

# 安装：
docker run -d -p 6379:6379 redis:7-alpine
```

#### 3.2.2 消息队列

**BullMQ**（基于 Redis 的任务队列）
```typescript
// 用途：
// - 异步任务处理（如账龄分析、报表生成）
// - 定时任务（如每日逾期检查）
// - 批量数据处理

import { Queue, Worker } from 'bullmq';

// 创建队列
const paymentQueue = new Queue('payment-processing', {
  connection: { host: 'localhost', port: 6379 }
});

// 添加任务
await paymentQueue.add('calculate-aging', {
  customerId: 123
});

// 处理任务
const worker = new Worker('payment-processing', async (job) => {
  if (job.name === 'calculate-aging') {
    await calculateAgingAnalysis(job.data.customerId);
  }
});
```

#### 3.2.3 报表生成

**ExcelJS**（已安装）
```typescript
// 用于导出 Excel 报表
import * as ExcelJS from 'exceljs';

async function generateFinancialReport() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('资产负债表');
  
  // 添加数据...
  
  await workbook.xlsx.writeFile('financial-report.xlsx');
}
```

**PDFKit**（PDF 生成）
```bash
npm install pdfkit

# 用途：
# - 生成正式财务报表 PDF
# - 生成发票、送货单
# - 生成质检报告
```

#### 3.2.4 定时任务

**node-cron**
```typescript
import cron from 'node-cron';

// 每天凌晨2点执行账龄分析
cron.schedule('0 2 * * *', async () => {
  console.log('开始每日账龄分析...');
  await dailyAgingAnalysis();
});

// 每小时检查逾期预警
cron.schedule('0 * * * *', async () => {
  await checkOverdueWarnings();
});
```

#### 3.2.5 数据可视化

**Chart.js / Recharts**（已使用 Recharts）
```typescript
// 用于：
// - 财务报表图表
// - 生产进度可视化
// - 回款趋势分析
```

**Apache ECharts**（更强大的图表库）
```bash
npm install echarts

# 优势：
# - 支持更复杂的图表类型
# - 更好的性能（大数据量）
# - 丰富的交互功能
```

#### 3.2.6 多语言和国际化

**i18next**
```typescript
import i18next from 'i18next';

// 配置三国语言
i18next.init({
  lng: 'zh',
  resources: {
    zh: { translation: require('./locales/zh.json') },
    en: { translation: require('./locales/en.json') },
    vi: { translation: require('./locales/vi.json') }
  }
});

// 使用
t('payment.overdue');  // 中文：逾期
                       // English: Overdue
                       // Tiếng Việt: Quá hạn
```

#### 3.2.7 文件存储

**MinIO**（对象存储，S3 兼容）
```bash
# 用途：
# - 存储收款凭证图片
# - 存储质检报告 PDF
# - 存储合同扫描件

# 部署：
docker run -p 9000:9000 -p 9001:9001 \
  minio/minio server /data --console-address ":9001"
```

#### 3.2.8 API 文档

**Swagger / OpenAPI**
```typescript
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

// 自动生成 API 文档
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: '爱牢达 ERP API',
      version: '1.0.0'
    }
  },
  apis: ['./src/routes/*.ts']
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```

#### 3.2.9 监控和日志

**Prometheus + Grafana**（监控）
```bash
# Prometheus 监控指标
# - API 响应时间
# - 数据库查询性能
# - 系统资源使用率

# Grafana 可视化仪表板
docker-compose up -d prometheus grafana
```

**Winston**（已使用 - 日志）
```typescript
// 增强日志配置
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});
```

---

## 四、部署方案

### 4.1 单机部署方案（开发/小规模）

#### 4.1.1 Windows 单机部署

**系统要求：**
- Windows 10/11 或 Windows Server 2019+
- 内存：8GB+
- 硬盘：50GB+
- CPU：4核+

**部署步骤：**

```powershell
# 1. 安装 Node.js
# 下载：https://nodejs.org/ (v18 LTS)

# 2. 安装 PostgreSQL（可选，生产推荐）
# 下载：https://www.postgresql.org/download/windows/

# 3. 克隆或解压项目
cd C:\Projects\ailoda

# 4. 安装依赖
npm install
cd backend && npm install && cd ..

# 5. 配置环境变量
# 创建 .env 文件
DATABASE_URL="file:./prisma/main.db"
JWT_SECRET="your-secret-key-change-this"
PORT=5001

# 6. 初始化数据库
cd backend
npx prisma migrate deploy
npx prisma db seed

# 7. 启动系统
# 双击 启动系统.bat
# 或手动启动：
start cmd /k "cd backend && npm run dev"
start cmd /k "npm run dev"
```

**一键启动脚本（`启动系统.bat`）：**
```bat
@echo off
echo ========================================
echo 启动爱牢达 ERP 系统
echo ========================================

echo.
echo [1/3] 启动后端服务器...
start "后端服务" cmd /k "cd backend && npm run dev"
timeout /t 3

echo [2/3] 启动前端服务器...
start "前端服务" cmd /k "npm run dev"
timeout /t 3

echo [3/3] 打开浏览器...
timeout /t 5
start http://localhost:3002

echo.
echo ========================================
echo 系统启动完成！
echo 前端地址: http://localhost:3002
echo 后端地址: http://localhost:5001
echo ========================================
pause
```

#### 4.1.2 Linux 单机部署

```bash
#!/bin/bash
# deploy_standalone.sh

# 1. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安装 PostgreSQL（可选）
sudo apt-get install -y postgresql postgresql-contrib

# 3. 克隆项目
cd /opt
git clone https://github.com/your-repo/ailoda-erp.git
cd ailoda-erp

# 4. 安装依赖
npm install
cd backend && npm install && cd ..

# 5. 配置环境变量
cat > backend/.env << EOF
DATABASE_URL="postgresql://ailoda:password@localhost:5432/ailoda"
JWT_SECRET="$(openssl rand -hex 32)"
PORT=5001
EOF

# 6. 初始化数据库
cd backend
npx prisma migrate deploy
npx prisma db seed

# 7. 构建前端
cd ..
npm run build

# 8. 使用 PM2 守护进程
npm install -g pm2
pm2 start backend/dist/server.js --name ailoda-backend
pm2 start npm --name ailoda-frontend -- run preview
pm2 save
pm2 startup
```

### 4.2 云端部署方案（生产环境）

#### 4.2.1 Docker 容器化部署

**Dockerfile（前端）：**
```dockerfile
# frontend.Dockerfile
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Dockerfile（后端）：**
```dockerfile
# backend.Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ .
RUN npx prisma generate

EXPOSE 5001
CMD ["node", "dist/server.js"]
```

**docker-compose.yml（完整栈）：**
```yaml
version: '3.8'

services:
  # PostgreSQL 数据库
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ailoda
      POSTGRES_USER: ailoda
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  # Redis 缓存
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped

  # 后端服务
  backend:
    build:
      context: .
      dockerfile: backend.Dockerfile
    environment:
      DATABASE_URL: postgresql://ailoda:${DB_PASSWORD}@postgres:5432/ailoda
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      PORT: 5001
    ports:
      - "5001:5001"
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  # 前端服务
  frontend:
    build:
      context: .
      dockerfile: frontend.Dockerfile
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

  # MinIO 对象存储
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    restart: unless-stopped

volumes:
  postgres_data:
  minio_data:
```

**部署命令：**
```bash
# 1. 创建 .env 文件
cat > .env << EOF
DB_PASSWORD=your_secure_password
JWT_SECRET=$(openssl rand -hex 32)
MINIO_USER=admin
MINIO_PASSWORD=your_minio_password
EOF

# 2. 启动所有服务
docker-compose up -d

# 3. 初始化数据库
docker-compose exec backend npx prisma migrate deploy
docker-compose exec backend npx prisma db seed

# 4. 查看日志
docker-compose logs -f

# 5. 停止服务
docker-compose down
```

#### 4.2.2 云服务商部署方案

**阿里云（中国）：**
```yaml
# 推荐配置：
- ECS 实例：2核4GB（起步）/ 4核8GB（推荐）
- RDS PostgreSQL：2核4GB
- Redis：1GB
- OSS 对象存储：按需
- SLB 负载均衡：小型

# 月成本估算：
- ECS（4核8GB）：¥300-400/月
- RDS（2核4GB）：¥400-500/月
- Redis（1GB）：¥100-150/月
- OSS：¥10-50/月（根据用量）
- 总计：¥810-1100/月
```

**AWS（美国）：**
```yaml
# 推荐配置：
- EC2: t3.medium (2vCPU, 4GB RAM)
- RDS PostgreSQL: db.t3.small
- ElastiCache Redis: cache.t3.micro
- S3: Standard storage
- ALB: Application Load Balancer

# 月成本估算（us-east-1）：
- EC2: $30-40/month
- RDS: $40-50/month
- ElastiCache: $15-20/month
- S3: $5-10/month
- 总计：$90-120/month
```

**Vultr/DigitalOcean（越南可用）：**
```yaml
# 推荐配置：
- Droplet/Instance: 2vCPU, 4GB RAM ($24/month)
- Managed PostgreSQL: 1GB ($15/month)
- Spaces/Object Storage: $5/month
- Load Balancer: $12/month（可选）

# 月成本估算：
- 总计：$44-56/month（不含负载均衡）
```

#### 4.2.3 Kubernetes 部署（大规模）

**deployment.yaml：**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ailoda-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ailoda-backend
  template:
    metadata:
      labels:
        app: ailoda-backend
    spec:
      containers:
      - name: backend
        image: your-registry/ailoda-backend:latest
        ports:
        - containerPort: 5001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: ailoda-secrets
              key: database-url
        - name: REDIS_URL
          value: redis://redis-service:6379
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: ailoda-backend-service
spec:
  selector:
    app: ailoda-backend
  ports:
  - port: 5001
    targetPort: 5001
  type: LoadBalancer
```

### 4.3 备份和灾备方案

#### 4.3.1 数据库备份

**PostgreSQL 自动备份脚本：**
```bash
#!/bin/bash
# backup_db.sh

BACKUP_DIR="/backups/postgresql"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="ailoda"

# 创建备份
pg_dump $DB_NAME > "$BACKUP_DIR/ailoda_$DATE.sql"

# 压缩备份
gzip "$BACKUP_DIR/ailoda_$DATE.sql"

# 删除30天前的备份
find $BACKUP_DIR -name "ailoda_*.sql.gz" -mtime +30 -delete

echo "备份完成: ailoda_$DATE.sql.gz"
```

**定时任务（Cron）：**
```bash
# 每天凌晨3点自动备份
0 3 * * * /opt/scripts/backup_db.sh >> /var/log/backup.log 2>&1
```

#### 4.3.2 文件备份

```bash
#!/bin/bash
# backup_files.sh

# 备份上传的文件
rsync -avz /opt/ailoda/uploads/ /backups/uploads/

# 备份到云存储（阿里云 OSS / AWS S3）
# ossutil cp -r /backups/ oss://your-bucket/backups/
# aws s3 sync /backups/ s3://your-bucket/backups/
```

---

## 五、实施路线图

### 阶段一：数据库扩展和基础功能（2-3周）

**Week 1-2：数据模型扩展**
- [ ] 扩展 Prisma schema（回款、生产、财务模型）
- [ ] 数据库迁移和测试
- [ ] API 路由设计
- [ ] 基础 CRUD 实现

**Week 3：前端基础页面**
- [ ] 回款管理页面框架
- [ ] 生产管理页面框架
- [ ] 财务报表页面框架
- [ ] 公司管理页面

### 阶段二：核心业务逻辑（3-4周）

**Week 4-5：回款追踪系统**
- [ ] 收款录入功能
- [ ] 账期计划管理
- [ ] 账龄分析计算
- [ ] 逾期预警机制
- [ ] 催收记录管理

**Week 6-7：生产管理系统**
- [ ] BOM 管理
- [ ] 工单创建和流转
- [ ] 领料管理
- [ ] 质检录入
- [ ] 库存管理

### 阶段三：财务报表系统（2-3周）

**Week 8-9：会计核心**
- [ ] 会计科目配置（三国）
- [ ] 凭证制单
- [ ] 凭证审核过账
- [ ] 总账和明细账

**Week 10：报表生成**
- [ ] 资产负债表（三国版本）
- [ ] 利润表（三国版本）
- [ ] 现金流量表
- [ ] 报表导出功能

### 阶段四：AI 功能增强（2周）

**Week 11：智能功能**
- [ ] 智能收款匹配
- [ ] 生产排程优化
- [ ] 财务异常检测
- [ ] AI 报表分析

**Week 12：优化和测试**
- [ ] 性能优化
- [ ] 全面测试
- [ ] Bug 修复
- [ ] 文档完善

### 阶段五：部署和上线（1周）

**Week 13：部署**
- [ ] 云服务器配置
- [ ] Docker 容器化
- [ ] 数据迁移
- [ ] 用户培训
- [ ] 正式上线

---

## 六、注意事项和风险控制

### 6.1 技术风险

**数据库性能：**
- SQLite 仅适合开发和小规模使用（<50人）
- 生产环境必须使用 PostgreSQL
- 需要合理设计索引
- 定期优化查询

**并发控制：**
- 财务凭证过账需要事务锁
- 库存出入库需要乐观锁
- 收款核销需要防重复提交

**数据一致性：**
- 跨表操作必须使用事务
- 关键数据需要触发器或事件监听
- 定期数据校验和对账

### 6.2 业务风险

**多货币处理：**
- 汇率波动风险
- 汇兑损益计算
- 报表折算准确性

**多国会计准则：**
- 不同国家差异大
- 需要专业会计师审核
- 定期更新会计政策

**数据安全：**
- 财务数据高度敏感
- 必须加密存储
- 严格权限控制
- 审计日志完整

### 6.3 合规性

**中国：**
- 增值税专用发票管理
- 金税盘对接（如需）
- 社保公积金申报

**越南：**
- VAT 发票要求
- 劳动法合规
- 外汇管制

**美国：**
- GAAP 准则遵循
- 各州税务差异
- SOX 合规（如上市）

---

## 七、成本估算

### 7.1 开发成本

**人力成本（假设使用 Claude Code）：**
- 后端开发：40-60 小时
- 前端开发：60-80 小时
- 测试和优化：20-30 小时
- 总计：120-170 小时

**如果自行开发：**
- 高级全栈工程师：$50-80/小时
- 总成本：$6,000-13,600

**使用 Claude Code 的优势：**
- 大幅降低开发时间
- 代码质量一致
- 持续迭代优化

### 7.2 运营成本（月度）

**云服务器方案（推荐）：**
```
阿里云（中国用户为主）：
- ECS 4核8GB：¥350/月
- RDS PostgreSQL 2核4GB：¥450/月
- Redis 1GB：¥120/月
- OSS：¥30/月
- 总计：¥950/月 ($130/月)

DigitalOcean（越南/国际用户为主）：
- Droplet 4GB：$24/月
- Managed PostgreSQL：$15/月
- Spaces：$5/月
- 总计：$44/月

混合云方案（多地部署）：
- 中国：阿里云 ¥950/月
- 越南：DigitalOcean $44/月
- 美国：AWS $50/月
- 总计：约 $220/月
```

**自建服务器（长期更经济）：**
```
硬件购置（一次性）：
- 服务器主机：$2,000-3,000
- UPS 不间断电源：$300-500
- 网络设备：$200-300
- 总计：约 $2,500-3,800

运营成本（月度）：
- 电费：$50-80/月
- 带宽：$100-200/月
- 维护：$50/月
- 总计：$200-330/月

ROI：6-12个月回本
```

### 7.3 其他成本

**域名和 SSL：**
- 域名：$10-15/年
- SSL 证书：免费（Let's Encrypt）或 $50-200/年

**备份存储：**
- 云备份：$10-30/月
- 异地备份：$20-50/月

**监控和安全：**
- 监控服务：免费（自建）或 $20-50/月
- 安全扫描：$10-30/月

---

## 八、总结

### 8.1 方案优势

✅ **基于现有系统优势：**
- 96.7 分的高质量基础
- 完整的 AI 智能化功能
- 成熟的技术架构

✅ **针对性解决痛点：**
- 深度回款追踪（核心需求）
- 完整生产管理（工厂必需）
- 三国财务报表（跨境合规）

✅ **技术先进性：**
- 全栈 TypeScript
- AI 驱动的智能化
- 微服务友好架构
- 云原生部署

✅ **成本控制：**
- 100% 开源技术栈
- 灵活的部署方案
- 可按需扩展

### 8.2 成功关键因素

🎯 **1. 分阶段实施**
- 不要一次性开发所有功能
- 先核心后辅助
- 持续迭代优化

🎯 **2. 数据质量**
- 初期数据录入准确性
- 历史数据清洗
- 定期数据校验

🎯 **3. 用户培训**
- 系统操作培训
- 业务流程培训
- 持续支持

🎯 **4. 性能监控**
- 实时性能监控
- 用户反馈收集
- 快速响应问题

### 8.3 下一步行动

**立即开始：**
1. ✅ 确认本方案
2. ✅ 准备开发环境
3. ✅ 开始数据库扩展
4. ✅ 并行开发前后端

**第一周目标：**
- 完成回款追踪数据模型
- 实现基础收款录入
- 搭建账龄分析框架

**第一个月目标：**
- 回款追踪系统上线
- 生产管理雏形完成
- 基础财务报表可用

---

**方案制定人：** Claude (Anthropic)  
**方案日期：** 2026年04月08日  
**方案版本：** V1.0  
**适用系统：** 爱牢达 AI CRM + ERP V2.0

---

🚀 **准备好了吗？让我们开始用 Claude Code 构建这个强大的系统吧！**

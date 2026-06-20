import type { ComponentType } from 'react';
import {
  ArrowRightLeft,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ContactRound,
  Factory,
  FileText,
  FileWarning,
  FlaskConical,
  HandCoins,
  LayoutDashboard,
  PackageCheck,
  ReceiptText,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UsersRound,
  Warehouse,
} from 'lucide-react';
import type { BuiltInUserRole, Language } from '../../types';

export const MODULE_ORDER = [
  'dashboard',
  'crm',
  'orders',
  'collections',
  'adjustment',
  'financeAnalytics',
  'contracts',
  'barter',
  'risk',
  'dealerAnalytics',
  'samples',
  'shipping',
  'discrepancies',
  'rma',
  'team',
  'assets',
  'production',
  'warehouse',
  'procurement',
  'audit',
] as const;

export type ModuleId = typeof MODULE_ORDER[number];
export type ModuleGroup = 'overview' | 'sales' | 'supply' | 'production' | 'governance';
export type ModuleOrnament = 'dot' | 'bar' | 'ring' | 'spark';

type LocalizedText = Record<Language, string>;
type LocalizedAliases = Record<Language, readonly string[]>;

export interface ModuleDefinition {
  id: ModuleId;
  group: ModuleGroup;
  icon: ComponentType<{ size?: number; className?: string }>;
  gradient: string;
  accent: string;
  ornament: ModuleOrnament;
  shortLabel: LocalizedText;
  title: LocalizedText;
  description: LocalizedText;
  aliases: LocalizedAliases;
  roles: readonly BuiltInUserRole[];
}

const allRoles = ['admin', 'manager', 'sales', 'warehouse', 'finance'] as const;

export const moduleRegistry: Record<ModuleId, ModuleDefinition> = {
  dashboard: {
    id: 'dashboard',
    group: 'overview',
    icon: LayoutDashboard,
    gradient: 'from-slate-800 via-blue-700 to-cyan-600',
    accent: 'bg-cyan-200',
    ornament: 'ring',
    shortLabel: { zh: '经营总览', en: 'Overview', vi: 'Tổng quan' },
    title: { zh: '爱劳达经营驾驶舱', en: 'AilaoDa Business Cockpit', vi: 'Bảng điều hành AilaoDa' },
    description: { zh: '查看销售、回款、库存、风险和待办总览', en: 'View sales, collections, inventory, risk, and tasks.', vi: 'Xem bán hàng, thu tiền, tồn kho, rủi ro và việc cần xử lý.' },
    aliases: { zh: ['首页', '仪表盘', '驾驶舱'], en: ['home', 'dashboard'], vi: ['trang chủ', 'bảng điều khiển'] },
    roles: allRoles,
  },
  crm: {
    id: 'crm',
    group: 'sales',
    icon: ContactRound,
    gradient: 'from-blue-700 via-indigo-600 to-sky-500',
    accent: 'bg-blue-100',
    ornament: 'dot',
    shortLabel: { zh: '客户档案', en: 'Customers', vi: 'Khách hàng' },
    title: { zh: '客户关系与信用档案', en: 'Customer Relationship and Credit Files', vi: 'Hồ sơ khách hàng và tín dụng' },
    description: { zh: '维护客户主数据、公海私海、联系人、地址和信用信息', en: 'Manage customer master data, pools, contacts, addresses, and credit.', vi: 'Quản lý dữ liệu khách hàng, nhóm khách, liên hệ, địa chỉ và tín dụng.' },
    aliases: { zh: ['CRM', '客户', '公海', '私海'], en: ['crm', 'client', 'account'], vi: ['crm', 'khách', 'hồ sơ'] },
    roles: ['admin', 'manager', 'sales', 'finance'],
  },
  orders: {
    id: 'orders',
    group: 'sales',
    icon: ReceiptText,
    gradient: 'from-blue-600 via-sky-600 to-cyan-500',
    accent: 'bg-sky-100',
    ornament: 'bar',
    shortLabel: { zh: '销售订单', en: 'Sales Orders', vi: 'Đơn bán' },
    title: { zh: '销售订单中心', en: 'Sales Order Center', vi: 'Trung tâm đơn bán hàng' },
    description: { zh: '处理订单头、明细行、状态、发货和回款关联', en: 'Handle order headers, line items, status, shipping, and payment links.', vi: 'Xử lý đầu đơn, dòng hàng, trạng thái, giao hàng và thu tiền.' },
    aliases: { zh: ['订单', '销售单', 'SO'], en: ['order', 'sales order', 'so'], vi: ['đơn hàng', 'bán hàng'] },
    roles: ['admin', 'manager', 'sales', 'finance'],
  },
  collections: {
    id: 'collections',
    group: 'sales',
    icon: HandCoins,
    gradient: 'from-emerald-600 via-teal-600 to-cyan-600',
    accent: 'bg-emerald-100',
    ornament: 'dot',
    shortLabel: { zh: '回款中心', en: 'Collections', vi: 'Thu tiền' },
    title: { zh: '回款核销中心', en: 'Collections and Verification Center', vi: 'Trung tâm thu tiền và đối soát' },
    description: { zh: '处理分批回款、核销、承诺付款、争议和催收', en: 'Manage partial payments, verification, promises, disputes, and reminders.', vi: 'Quản lý thu từng phần, xác nhận, cam kết, tranh chấp và nhắc nợ.' },
    aliases: { zh: ['收款', '核销', '催收'], en: ['payment', 'receivable', 'collection'], vi: ['thanh toán', 'công nợ'] },
    roles: ['admin', 'manager', 'sales', 'finance'],
  },
  adjustment: {
    id: 'adjustment',
    group: 'sales',
    icon: BookOpenCheck,
    gradient: 'from-teal-700 via-sky-700 to-slate-800',
    accent: 'bg-teal-100',
    ornament: 'ring',
    shortLabel: { zh: '应收调整', en: 'AR Adjust', vi: 'Điều chỉnh AR' },
    title: { zh: '应收调账中心', en: 'Accounts Receivable Adjustment Center', vi: 'Trung tâm điều chỉnh phải thu' },
    description: { zh: '统一记录财务、生产、库存和客户应收调整', en: 'Record finance, production, inventory, and receivable adjustments.', vi: 'Ghi nhận điều chỉnh tài chính, sản xuất, tồn kho và phải thu.' },
    aliases: { zh: ['调账', '调整', '应收'], en: ['adjustment', 'ar'], vi: ['điều chỉnh', 'phải thu'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  financeAnalytics: {
    id: 'financeAnalytics',
    group: 'overview',
    icon: ChartNoAxesCombined,
    gradient: 'from-emerald-700 via-green-600 to-teal-600',
    accent: 'bg-green-100',
    ornament: 'spark',
    shortLabel: { zh: '财务经营', en: 'Finance', vi: 'Tài chính' },
    title: { zh: '财务经营分析', en: 'Finance Operations Analytics', vi: 'Phân tích tài chính vận hành' },
    description: { zh: '查看账龄、现金流、调账、回款和经营风险', en: 'View aging, cashflow, adjustments, collections, and financial risk.', vi: 'Xem tuổi nợ, dòng tiền, điều chỉnh, thu tiền và rủi ro.' },
    aliases: { zh: ['财务', '经营', '报表'], en: ['finance', 'reporting'], vi: ['tài chính', 'báo cáo'] },
    roles: ['admin', 'manager', 'finance'],
  },
  contracts: {
    id: 'contracts',
    group: 'sales',
    icon: FileText,
    gradient: 'from-slate-700 via-slate-800 to-zinc-900',
    accent: 'bg-slate-200',
    ornament: 'bar',
    shortLabel: { zh: '合同中心', en: 'Contracts', vi: 'Hợp đồng' },
    title: { zh: '合同管理中心', en: 'Contract Management Center', vi: 'Trung tâm hợp đồng' },
    description: { zh: '管理销售、采购合同、OCR 提取和履约关联', en: 'Manage sales and purchase contracts, OCR extraction, and fulfillment links.', vi: 'Quản lý hợp đồng bán/mua, OCR và liên kết thực hiện.' },
    aliases: { zh: ['合同', '协议'], en: ['contract', 'agreement'], vi: ['hợp đồng', 'thỏa thuận'] },
    roles: ['admin', 'manager', 'sales', 'finance'],
  },
  barter: {
    id: 'barter',
    group: 'sales',
    icon: ArrowRightLeft,
    gradient: 'from-cyan-700 via-blue-700 to-slate-800',
    accent: 'bg-cyan-100',
    ornament: 'dot',
    shortLabel: { zh: '货抵结算', en: 'Barter Settle', vi: 'Đối trừ hàng' },
    title: { zh: '货抵支付 / 换货贸易', en: 'Goods Offset Payment / Barter Trade', vi: 'Thanh toán hàng đổi hàng / đối trừ' },
    description: { zh: '处理货值估价、分批抵扣、核销、差额和冲销', en: 'Handle goods valuation, partial offsets, verification, gaps, and reversals.', vi: 'Xử lý định giá, đối trừ từng phần, xác nhận, chênh lệch và đảo bút toán.' },
    aliases: { zh: ['货抵', '换货', '抵扣'], en: ['barter', 'offset', 'goods payment'], vi: ['đổi hàng', 'đối trừ'] },
    roles: ['admin', 'manager', 'sales', 'warehouse'],
  },
  risk: {
    id: 'risk',
    group: 'governance',
    icon: ShieldAlert,
    gradient: 'from-rose-600 via-red-600 to-orange-500',
    accent: 'bg-rose-100',
    ornament: 'ring',
    shortLabel: { zh: '风控中心', en: 'Risk', vi: 'Rủi ro' },
    title: { zh: '信用与经营风控', en: 'Credit and Operations Risk Control', vi: 'Kiểm soát tín dụng và vận hành' },
    description: { zh: '监控信用风险、逾期、异常和管理盲区', en: 'Monitor credit risk, overdue items, anomalies, and blind spots.', vi: 'Theo dõi rủi ro tín dụng, quá hạn, bất thường và điểm mù.' },
    aliases: { zh: ['风控', '风险', '信用'], en: ['risk', 'credit'], vi: ['rủi ro', 'tín dụng'] },
    roles: ['admin', 'manager', 'finance', 'sales'],
  },
  dealerAnalytics: {
    id: 'dealerAnalytics',
    group: 'overview',
    icon: BarChart3,
    gradient: 'from-emerald-600 via-blue-600 to-indigo-700',
    accent: 'bg-emerald-100',
    ornament: 'spark',
    shortLabel: { zh: '渠道经营', en: 'Channels', vi: 'Kênh bán' },
    title: { zh: '内销 / 分销经营分析', en: 'Direct and Channel Sales Analytics', vi: 'Phân tích bán trực tiếp và phân phối' },
    description: { zh: '分析内销、分销、区域、业务员和渠道绩效', en: 'Analyze direct sales, distribution, regions, sales reps, and channel performance.', vi: 'Phân tích bán trực tiếp, phân phối, khu vực và hiệu suất kênh.' },
    aliases: { zh: ['经销', '分销', '内销', '渠道'], en: ['dealer', 'channel', 'distribution'], vi: ['đại lý', 'phân phối'] },
    roles: ['admin', 'manager', 'finance'],
  },
  samples: {
    id: 'samples',
    group: 'production',
    icon: FlaskConical,
    gradient: 'from-teal-600 via-cyan-600 to-blue-700',
    accent: 'bg-teal-100',
    ornament: 'bar',
    shortLabel: { zh: '样品管理', en: 'Samples', vi: 'Mẫu thử' },
    title: { zh: '样品申请与跟进', en: 'Sample Requests and Follow-up', vi: 'Yêu cầu mẫu và theo dõi' },
    description: { zh: '管理样品申请、寄出、测试、反馈和后续跟进', en: 'Manage sample requests, sending, testing, feedback, and follow-up.', vi: 'Quản lý yêu cầu mẫu, gửi mẫu, thử nghiệm, phản hồi và theo dõi.' },
    aliases: { zh: ['样品', '寄样', '测试'], en: ['sample', 'testing'], vi: ['mẫu', 'thử nghiệm'] },
    roles: ['admin', 'manager', 'sales', 'warehouse'],
  },
  shipping: {
    id: 'shipping',
    group: 'supply',
    icon: Truck,
    gradient: 'from-slate-600 via-blue-600 to-cyan-600',
    accent: 'bg-sky-100',
    ornament: 'dot',
    shortLabel: { zh: '发货签收', en: 'Shipping', vi: 'Giao hàng' },
    title: { zh: '发货物流与签收', en: 'Shipping, Logistics, and POD', vi: 'Giao hàng, logistics và ký nhận' },
    description: { zh: '处理发货、物流、签收凭证、OCR 和出库扣减', en: 'Handle shipping, logistics, POD, OCR, and outbound stock deduction.', vi: 'Xử lý giao hàng, vận chuyển, POD, OCR và xuất kho.' },
    aliases: { zh: ['发货', '物流', '签收', 'POD'], en: ['shipping', 'logistics', 'pod'], vi: ['giao hàng', 'vận chuyển', 'ký nhận'] },
    roles: ['admin', 'manager', 'sales', 'warehouse'],
  },
  discrepancies: {
    id: 'discrepancies',
    group: 'supply',
    icon: FileWarning,
    gradient: 'from-amber-600 via-orange-600 to-rose-600',
    accent: 'bg-amber-100',
    ornament: 'spark',
    shortLabel: { zh: '收发差异', en: 'Discrepancy', vi: 'Sai lệch' },
    title: { zh: '收发货差异处理', en: 'Receiving and Shipping Discrepancy Workbench', vi: 'Xử lý sai lệch nhận/giao hàng' },
    description: { zh: '处理拒收、短签、容差规则和差异动作流', en: 'Handle rejections, short receipts, tolerance rules, and actions.', vi: 'Xử lý từ chối, thiếu hàng, quy tắc dung sai và hành động.' },
    aliases: { zh: ['差异', '拒收', '短签', '容差'], en: ['discrepancy', 'short receipt'], vi: ['sai lệch', 'thiếu hàng'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  rma: {
    id: 'rma',
    group: 'production',
    icon: RotateCcw,
    gradient: 'from-orange-600 via-amber-600 to-red-600',
    accent: 'bg-orange-100',
    ornament: 'ring',
    shortLabel: { zh: '售后退换', en: 'After-sales', vi: 'Hậu mãi' },
    title: { zh: '售后退换与补偿', en: 'After-sales Returns and Compensation', vi: 'Trả đổi và bồi thường hậu mãi' },
    description: { zh: '管理退货、换货、补偿、审核和问题闭环', en: 'Manage returns, replacements, compensation, approval, and closure.', vi: 'Quản lý trả hàng, đổi hàng, bồi thường, duyệt và khép kín.' },
    aliases: { zh: ['售后', '退货', '换货', 'RMA'], en: ['rma', 'return', 'after sales'], vi: ['trả hàng', 'đổi hàng'] },
    roles: ['admin', 'manager', 'sales'],
  },
  team: {
    id: 'team',
    group: 'governance',
    icon: UsersRound,
    gradient: 'from-indigo-700 via-blue-700 to-slate-800',
    accent: 'bg-indigo-100',
    ornament: 'dot',
    shortLabel: { zh: '组织权限', en: 'Org & Roles', vi: 'Tổ chức' },
    title: { zh: '用户、角色与权限', en: 'Users, Roles, and Permissions', vi: 'Người dùng, vai trò và quyền' },
    description: { zh: '管理用户、角色、业务线、权限点和授权边界', en: 'Manage users, roles, business lines, permission points, and boundaries.', vi: 'Quản lý người dùng, vai trò, tuyến kinh doanh và quyền.' },
    aliases: { zh: ['团队', '角色', '权限', '用户'], en: ['team', 'roles', 'permissions'], vi: ['đội ngũ', 'vai trò', 'quyền'] },
    roles: ['admin', 'manager'],
  },
  assets: {
    id: 'assets',
    group: 'governance',
    icon: BriefcaseBusiness,
    gradient: 'from-stone-600 via-slate-700 to-zinc-800',
    accent: 'bg-stone-100',
    ornament: 'bar',
    shortLabel: { zh: '资产台账', en: 'Assets', vi: 'Tài sản' },
    title: { zh: '资产与设备台账', en: 'Asset and Equipment Ledger', vi: 'Sổ tài sản và thiết bị' },
    description: { zh: '管理周转资产、设备、批次和归还流转记录', en: 'Manage returnable assets, equipment, batches, and movement records.', vi: 'Quản lý tài sản luân chuyển, thiết bị, lô và luân chuyển.' },
    aliases: { zh: ['资产', '设备', '周转箱'], en: ['asset', 'equipment'], vi: ['tài sản', 'thiết bị'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  production: {
    id: 'production',
    group: 'production',
    icon: Factory,
    gradient: 'from-emerald-700 via-teal-700 to-cyan-700',
    accent: 'bg-emerald-100',
    ornament: 'spark',
    shortLabel: { zh: '生产配方', en: 'Production', vi: 'Sản xuất' },
    title: { zh: '生产配方与工单', en: 'Production Formulas and Work Orders', vi: 'Công thức sản xuất và lệnh sản xuất' },
    description: { zh: '维护化工 BOM、工单、耗料、成品入库和批次追溯', en: 'Manage chemical BOM, work orders, consumption, finished goods, and batches.', vi: 'Quản lý BOM hóa chất, lệnh sản xuất, tiêu hao, nhập kho và lô.' },
    aliases: { zh: ['生产', 'BOM', '配方', '工单'], en: ['production', 'bom', 'formula'], vi: ['sản xuất', 'bom', 'công thức'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  warehouse: {
    id: 'warehouse',
    group: 'supply',
    icon: Warehouse,
    gradient: 'from-amber-600 via-orange-600 to-yellow-600',
    accent: 'bg-amber-100',
    ornament: 'bar',
    shortLabel: { zh: '仓储库存', en: 'Warehouse', vi: 'Kho hàng' },
    title: { zh: '仓库、库位与库存', en: 'Warehouse, Locations, and Inventory', vi: 'Kho, vị trí và tồn kho' },
    description: { zh: '管理仓库、库位、库存台账、手动入库和移动记录', en: 'Manage warehouses, locations, stock ledger, inbound, and movements.', vi: 'Quản lý kho, vị trí, sổ tồn kho, nhập kho và luân chuyển.' },
    aliases: { zh: ['仓库', '库存', '库位'], en: ['warehouse', 'inventory', 'stock'], vi: ['kho', 'tồn kho'] },
    roles: ['admin', 'manager', 'warehouse'],
  },
  procurement: {
    id: 'procurement',
    group: 'supply',
    icon: PackageCheck,
    gradient: 'from-orange-600 via-amber-600 to-teal-600',
    accent: 'bg-orange-100',
    ornament: 'ring',
    shortLabel: { zh: '采购收货', en: 'Procurement', vi: 'Mua hàng' },
    title: { zh: '采购、供应商与收货', en: 'Procurement, Suppliers, and Receiving', vi: 'Mua hàng, nhà cung cấp và nhận hàng' },
    description: { zh: '管理供应商、采购单、分批收货、入库和 B2B 协同', en: 'Manage suppliers, purchase orders, partial receiving, inbound, and B2B links.', vi: 'Quản lý nhà cung cấp, đơn mua, nhận từng phần, nhập kho và B2B.' },
    aliases: { zh: ['采购', '供应商', '收货', '入库'], en: ['procurement', 'supplier', 'receiving'], vi: ['mua hàng', 'nhà cung cấp', 'nhận hàng'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  audit: {
    id: 'audit',
    group: 'governance',
    icon: ShieldCheck,
    gradient: 'from-slate-700 via-slate-800 to-slate-900',
    accent: 'bg-slate-200',
    ornament: 'dot',
    shortLabel: { zh: '审计日志', en: 'Audit Logs', vi: 'Nhật ký' },
    title: { zh: '系统审计与操作日志', en: 'System Audit and Operation Logs', vi: 'Nhật ký hệ thống và thao tác' },
    description: { zh: '查看系统操作、权限动作、异常和审计追踪', en: 'View operations, permission actions, anomalies, and audit trails.', vi: 'Xem thao tác, quyền, bất thường và dấu vết kiểm toán.' },
    aliases: { zh: ['审计', '日志', '操作记录'], en: ['audit', 'log'], vi: ['nhật ký', 'kiểm toán'] },
    roles: ['admin'],
  },
};

export const isModuleId = (id: string): id is ModuleId => (
  Object.prototype.hasOwnProperty.call(moduleRegistry, id)
);

export const getModuleDefinition = (id: string): ModuleDefinition => (
  isModuleId(id) ? moduleRegistry[id] : moduleRegistry.dashboard
);

const pickLocalized = (text: LocalizedText, language: Language): string => (
  text[language] || text.zh
);

export const getModuleLabel = (id: string, language: Language): string => (
  pickLocalized(getModuleDefinition(id).shortLabel, language)
);

export const getModuleTitle = (id: string, language: Language): string => (
  pickLocalized(getModuleDefinition(id).title, language)
);

export const getModuleDescription = (id: string, language: Language): string => (
  pickLocalized(getModuleDefinition(id).description, language)
);

export const getModuleAliases = (id: string, language: Language): readonly string[] => {
  const definition = getModuleDefinition(id);
  return [
    ...definition.aliases.zh,
    ...definition.aliases.en,
    ...definition.aliases.vi,
    ...(definition.aliases[language] || []),
    definition.id,
  ];
};

export const getNavigationModules = (): readonly ModuleDefinition[] => (
  MODULE_ORDER.map(id => moduleRegistry[id])
);

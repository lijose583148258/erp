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
  PackageSearch,
  ReceiptText,
  RotateCcw,
  Settings,
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
  'materials',
  'production',
  'warehouse',
  'procurement',
  'audit',
  'settings',
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
    shortLabel: { zh: '经营总览', en: 'Overview', vi: 'Tong quan' },
    title: { zh: '爱劳达经营驾驶舱', en: 'AilaoDa Business Cockpit', vi: 'Bang dieu hanh AilaoDa' },
    description: { zh: '查看销售、回款、库存、风险和待办总览。', en: 'View sales, collections, inventory, risk, and tasks.', vi: 'Xem ban hang, thu tien, ton kho, rui ro va viec can xu ly.' },
    aliases: { zh: ['首页', '仪表盘', '驾驶舱'], en: ['home', 'dashboard'], vi: ['trang chu', 'bang dieu khien'] },
    roles: allRoles,
  },
  crm: {
    id: 'crm',
    group: 'sales',
    icon: ContactRound,
    gradient: 'from-blue-700 via-indigo-600 to-sky-500',
    accent: 'bg-blue-100',
    ornament: 'dot',
    shortLabel: { zh: '客户档案', en: 'Customers', vi: 'Khach hang' },
    title: { zh: '客户关系与信用档案', en: 'Customer Relationship and Credit Files', vi: 'Ho so khach hang va tin dung' },
    description: { zh: '维护客户主数据、公海私海、联系人、地址和信用信息。', en: 'Manage customer master data, pools, contacts, addresses, and credit.', vi: 'Quan ly du lieu khach hang, nhom khach, lien he, dia chi va tin dung.' },
    aliases: { zh: ['CRM', '客户', '公海', '私海'], en: ['crm', 'client', 'account'], vi: ['crm', 'khach', 'ho so'] },
    roles: ['admin', 'manager', 'sales', 'finance'],
  },
  orders: {
    id: 'orders',
    group: 'sales',
    icon: ReceiptText,
    gradient: 'from-blue-600 via-sky-600 to-cyan-500',
    accent: 'bg-sky-100',
    ornament: 'bar',
    shortLabel: { zh: '销售订单', en: 'Sales Orders', vi: 'Don ban' },
    title: { zh: '销售订单中心', en: 'Sales Order Center', vi: 'Trung tam don ban hang' },
    description: { zh: '处理订单头、明细行、状态、发货和回款关联。', en: 'Handle order headers, line items, status, shipping, and payment links.', vi: 'Xu ly don hang, dong hang, trang thai, giao hang va thu tien.' },
    aliases: { zh: ['订单', '销售单', 'SO'], en: ['order', 'sales order', 'so'], vi: ['don hang', 'ban hang'] },
    roles: ['admin', 'manager', 'sales', 'finance'],
  },
  collections: {
    id: 'collections',
    group: 'sales',
    icon: HandCoins,
    gradient: 'from-emerald-600 via-teal-600 to-cyan-600',
    accent: 'bg-emerald-100',
    ornament: 'dot',
    shortLabel: { zh: '回款中心', en: 'Collections', vi: 'Thu tien' },
    title: { zh: '回款核销中心', en: 'Collections and Verification Center', vi: 'Trung tam thu tien va doi soat' },
    description: { zh: '处理分批回款、核销、承诺付款、争议和催收。', en: 'Manage partial payments, verification, promises, disputes, and reminders.', vi: 'Quan ly thu tung phan, doi soat, cam ket, tranh chap va nhac no.' },
    aliases: { zh: ['收款', '核销', '催收'], en: ['payment', 'receivable', 'collection'], vi: ['thanh toan', 'cong no'] },
    roles: ['admin', 'manager', 'sales', 'finance'],
  },
  adjustment: {
    id: 'adjustment',
    group: 'sales',
    icon: BookOpenCheck,
    gradient: 'from-teal-700 via-sky-700 to-slate-800',
    accent: 'bg-teal-100',
    ornament: 'ring',
    shortLabel: { zh: '应收调整', en: 'AR Adjust', vi: 'Dieu chinh AR' },
    title: { zh: '应收调账中心', en: 'Accounts Receivable Adjustment Center', vi: 'Trung tam dieu chinh phai thu' },
    description: { zh: '统一记录财务、生产、库存和客户应收调整。', en: 'Record finance, production, inventory, and receivable adjustments.', vi: 'Ghi nhan dieu chinh tai chinh, san xuat, ton kho va phai thu.' },
    aliases: { zh: ['调账', '调整', '应收'], en: ['adjustment', 'ar'], vi: ['dieu chinh', 'phai thu'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  financeAnalytics: {
    id: 'financeAnalytics',
    group: 'overview',
    icon: ChartNoAxesCombined,
    gradient: 'from-emerald-700 via-green-600 to-teal-600',
    accent: 'bg-green-100',
    ornament: 'spark',
    shortLabel: { zh: '财务经营', en: 'Finance', vi: 'Tai chinh' },
    title: { zh: '财务经营分析', en: 'Finance Operations Analytics', vi: 'Phan tich tai chinh van hanh' },
    description: { zh: '查看账龄、现金流、调账、回款和经营风险。', en: 'View aging, cashflow, adjustments, collections, and financial risk.', vi: 'Xem tuoi no, dong tien, dieu chinh, thu tien va rui ro.' },
    aliases: { zh: ['财务', '经营', '报表'], en: ['finance', 'reporting'], vi: ['tai chinh', 'bao cao'] },
    roles: ['admin', 'manager', 'finance'],
  },
  contracts: {
    id: 'contracts',
    group: 'sales',
    icon: FileText,
    gradient: 'from-slate-700 via-slate-800 to-zinc-900',
    accent: 'bg-slate-200',
    ornament: 'bar',
    shortLabel: { zh: '合同中心', en: 'Contracts', vi: 'Hop dong' },
    title: { zh: '合同管理中心', en: 'Contract Management Center', vi: 'Trung tam hop dong' },
    description: { zh: '管理销售、采购合同、OCR 提取和履约关联。', en: 'Manage sales and purchase contracts, OCR extraction, and fulfillment links.', vi: 'Quan ly hop dong ban/mua, OCR va lien ket thuc hien.' },
    aliases: { zh: ['合同', '协议'], en: ['contract', 'agreement'], vi: ['hop dong', 'thoa thuan'] },
    roles: ['admin', 'manager', 'sales', 'finance'],
  },
  barter: {
    id: 'barter',
    group: 'sales',
    icon: ArrowRightLeft,
    gradient: 'from-cyan-700 via-blue-700 to-slate-800',
    accent: 'bg-cyan-100',
    ornament: 'dot',
    shortLabel: { zh: '货抵结算', en: 'Barter Settle', vi: 'Doi tru hang' },
    title: { zh: '货抵支付 / 换货贸易', en: 'Goods Offset Payment / Barter Trade', vi: 'Thanh toan bang hang / doi tru' },
    description: { zh: '处理货值估价、分批抵扣、核销、差额和冲销。', en: 'Handle goods valuation, partial offsets, verification, gaps, and reversals.', vi: 'Xu ly dinh gia, doi tru tung phan, xac nhan, chenh lech va dao but toan.' },
    aliases: { zh: ['货抵', '换货', '抵扣'], en: ['barter', 'offset', 'goods payment'], vi: ['doi hang', 'doi tru'] },
    roles: ['admin', 'manager', 'sales', 'warehouse'],
  },
  risk: {
    id: 'risk',
    group: 'governance',
    icon: ShieldAlert,
    gradient: 'from-rose-600 via-red-600 to-orange-500',
    accent: 'bg-rose-100',
    ornament: 'ring',
    shortLabel: { zh: '风控中心', en: 'Risk', vi: 'Rui ro' },
    title: { zh: '信用与经营风控', en: 'Credit and Operations Risk Control', vi: 'Kiem soat tin dung va van hanh' },
    description: { zh: '监控信用风险、逾期、异常和管理盲区。', en: 'Monitor credit risk, overdue items, anomalies, and blind spots.', vi: 'Theo doi rui ro tin dung, qua han, bat thuong va diem mu.' },
    aliases: { zh: ['风控', '风险', '信用'], en: ['risk', 'credit'], vi: ['rui ro', 'tin dung'] },
    roles: ['admin', 'manager', 'finance', 'sales'],
  },
  dealerAnalytics: {
    id: 'dealerAnalytics',
    group: 'overview',
    icon: BarChart3,
    gradient: 'from-emerald-600 via-blue-600 to-indigo-700',
    accent: 'bg-emerald-100',
    ornament: 'spark',
    shortLabel: { zh: '渠道经营', en: 'Channels', vi: 'Kenh ban' },
    title: { zh: '内销 / 分销经营分析', en: 'Direct and Channel Sales Analytics', vi: 'Phan tich ban truc tiep va phan phoi' },
    description: { zh: '分析内销、分销、区域、业务员和渠道绩效。', en: 'Analyze direct sales, distribution, regions, sales reps, and channel performance.', vi: 'Phan tich ban truc tiep, phan phoi, khu vuc va hieu suat kenh.' },
    aliases: { zh: ['经销', '分销', '内销', '渠道'], en: ['dealer', 'channel', 'distribution'], vi: ['dai ly', 'phan phoi'] },
    roles: ['admin', 'manager', 'finance'],
  },
  samples: {
    id: 'samples',
    group: 'production',
    icon: FlaskConical,
    gradient: 'from-teal-600 via-cyan-600 to-blue-700',
    accent: 'bg-teal-100',
    ornament: 'bar',
    shortLabel: { zh: '样品管理', en: 'Samples', vi: 'Mau thu' },
    title: { zh: '样品申请与跟进', en: 'Sample Requests and Follow-up', vi: 'Yeu cau mau va theo doi' },
    description: { zh: '管理样品申请、寄出、测试、反馈和后续跟进。', en: 'Manage sample requests, sending, testing, feedback, and follow-up.', vi: 'Quan ly yeu cau mau, gui mau, thu nghiem, phan hoi va theo doi.' },
    aliases: { zh: ['样品', '寄样', '测试'], en: ['sample', 'testing'], vi: ['mau', 'thu nghiem'] },
    roles: ['admin', 'manager', 'sales', 'warehouse'],
  },
  shipping: {
    id: 'shipping',
    group: 'supply',
    icon: Truck,
    gradient: 'from-slate-600 via-blue-600 to-cyan-600',
    accent: 'bg-sky-100',
    ornament: 'dot',
    shortLabel: { zh: '发货签收', en: 'Shipping', vi: 'Giao hang' },
    title: { zh: '发货物流与签收', en: 'Shipping, Logistics, and POD', vi: 'Giao hang, logistics va POD' },
    description: { zh: '处理发货、物流、签收凭证、OCR 和出库扣减。', en: 'Handle shipping, logistics, POD, OCR, and outbound stock deduction.', vi: 'Xu ly giao hang, van chuyen, POD, OCR va xuat kho.' },
    aliases: { zh: ['发货', '物流', '签收', 'POD'], en: ['shipping', 'logistics', 'pod'], vi: ['giao hang', 'van chuyen', 'pod'] },
    roles: ['admin', 'manager', 'sales', 'warehouse'],
  },
  discrepancies: {
    id: 'discrepancies',
    group: 'supply',
    icon: FileWarning,
    gradient: 'from-amber-600 via-orange-600 to-rose-600',
    accent: 'bg-amber-100',
    ornament: 'spark',
    shortLabel: { zh: '收发差异', en: 'Discrepancy', vi: 'Sai lech' },
    title: { zh: '收发货差异处理', en: 'Receiving and Shipping Discrepancy Workbench', vi: 'Xu ly sai lech nhan/giao hang' },
    description: { zh: '处理拒收、短签、容差规则和差异动作流。', en: 'Handle rejections, short receipts, tolerance rules, and actions.', vi: 'Xu ly tu choi, thieu hang, quy tac dung sai va hanh dong.' },
    aliases: { zh: ['差异', '拒收', '短签', '容差'], en: ['discrepancy', 'short receipt'], vi: ['sai lech', 'thieu hang'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  rma: {
    id: 'rma',
    group: 'production',
    icon: RotateCcw,
    gradient: 'from-orange-600 via-amber-600 to-red-600',
    accent: 'bg-orange-100',
    ornament: 'ring',
    shortLabel: { zh: '售后退换', en: 'After-sales', vi: 'Hau mai' },
    title: { zh: '售后退换与补偿', en: 'After-sales Returns and Compensation', vi: 'Tra doi va boi thuong hau mai' },
    description: { zh: '管理退货、换货、补偿、审核和问题闭环。', en: 'Manage returns, replacements, compensation, approval, and closure.', vi: 'Quan ly tra hang, doi hang, boi thuong, duyet va dong van de.' },
    aliases: { zh: ['售后', '退货', '换货', 'RMA'], en: ['rma', 'return', 'after sales'], vi: ['tra hang', 'doi hang'] },
    roles: ['admin', 'manager', 'sales'],
  },
  team: {
    id: 'team',
    group: 'governance',
    icon: UsersRound,
    gradient: 'from-indigo-700 via-blue-700 to-slate-800',
    accent: 'bg-indigo-100',
    ornament: 'dot',
    shortLabel: { zh: '组织权限', en: 'Org & Roles', vi: 'To chuc' },
    title: { zh: '用户、角色与权限', en: 'Users, Roles, and Permissions', vi: 'Nguoi dung, vai tro va quyen' },
    description: { zh: '管理员工账号、角色、业务线、权限点和授权边界。', en: 'Manage users, roles, business lines, permission points, and boundaries.', vi: 'Quan ly nguoi dung, vai tro, tuyen kinh doanh va quyen.' },
    aliases: { zh: ['团队', '角色', '权限', '用户'], en: ['team', 'roles', 'permissions'], vi: ['doi ngu', 'vai tro', 'quyen'] },
    roles: ['admin', 'manager'],
  },
  assets: {
    id: 'assets',
    group: 'governance',
    icon: BriefcaseBusiness,
    gradient: 'from-stone-600 via-slate-700 to-zinc-800',
    accent: 'bg-stone-100',
    ornament: 'bar',
    shortLabel: { zh: '资产台账', en: 'Assets', vi: 'Tai san' },
    title: { zh: '资产与设备台账', en: 'Asset and Equipment Ledger', vi: 'So tai san va thiet bi' },
    description: { zh: '管理周转资产、设备、批次和归还流转记录。', en: 'Manage returnable assets, equipment, batches, and movement records.', vi: 'Quan ly tai san luan chuyen, thiet bi, lo va luan chuyen.' },
    aliases: { zh: ['资产', '设备', '周转箱'], en: ['asset', 'equipment'], vi: ['tai san', 'thiet bi'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  materials: {
    id: 'materials',
    group: 'production',
    icon: PackageSearch,
    gradient: 'from-cyan-700 via-teal-700 to-emerald-700',
    accent: 'bg-cyan-100',
    ornament: 'ring',
    shortLabel: { zh: '物料主数据', en: 'Materials', vi: 'Vat tu' },
    title: { zh: '统一物料主数据中心', en: 'Canonical Material Master', vi: 'Du lieu vat tu chuan' },
    description: { zh: '统一编码、多语言名称、别名、化工标识、单位和生命周期，避免重复建档。', en: 'Govern codes, multilingual names, aliases, chemical identity, units, and lifecycle.', vi: 'Quan ly ma, ten da ngon ngu, bi danh, dinh danh hoa chat, don vi va vong doi.' },
    aliases: { zh: ['物料', '原料', '产品主数据', 'CAS'], en: ['material', 'product master', 'cas'], vi: ['vat tu', 'nguyen lieu', 'hoa chat'] },
    roles: ['admin', 'manager'],
  },
  production: {
    id: 'production',
    group: 'production',
    icon: Factory,
    gradient: 'from-emerald-700 via-teal-700 to-cyan-700',
    accent: 'bg-emerald-100',
    ornament: 'spark',
    shortLabel: { zh: '生产配方', en: 'Production', vi: 'San xuat' },
    title: { zh: '生产配方与工单', en: 'Production Formulas and Work Orders', vi: 'Cong thuc va lenh san xuat' },
    description: { zh: '维护化工 BOM、工单、耗料、成品入库和批次追溯。', en: 'Manage chemical BOM, work orders, consumption, finished goods, and batches.', vi: 'Quan ly BOM hoa chat, lenh san xuat, tieu hao, nhap kho va lo.' },
    aliases: { zh: ['生产', 'BOM', '配方', '工单'], en: ['production', 'bom', 'formula'], vi: ['san xuat', 'bom', 'cong thuc'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  warehouse: {
    id: 'warehouse',
    group: 'supply',
    icon: Warehouse,
    gradient: 'from-amber-600 via-orange-600 to-yellow-600',
    accent: 'bg-amber-100',
    ornament: 'bar',
    shortLabel: { zh: '仓储库存', en: 'Warehouse', vi: 'Kho hang' },
    title: { zh: '仓库、库位与库存', en: 'Warehouse, Locations, and Inventory', vi: 'Kho, vi tri va ton kho' },
    description: { zh: '管理仓库、库位、库存台账、手工入库和移动记录。', en: 'Manage warehouses, locations, stock ledger, inbound, and movements.', vi: 'Quan ly kho, vi tri, so ton kho, nhap kho va luan chuyen.' },
    aliases: { zh: ['仓库', '库存', '库位'], en: ['warehouse', 'inventory', 'stock'], vi: ['kho', 'ton kho'] },
    roles: ['admin', 'manager', 'warehouse'],
  },
  procurement: {
    id: 'procurement',
    group: 'supply',
    icon: PackageCheck,
    gradient: 'from-orange-600 via-amber-600 to-teal-600',
    accent: 'bg-orange-100',
    ornament: 'ring',
    shortLabel: { zh: '采购收货', en: 'Procurement', vi: 'Mua hang' },
    title: { zh: '采购、供应商与收货', en: 'Procurement, Suppliers, and Receiving', vi: 'Mua hang, nha cung cap va nhan hang' },
    description: { zh: '管理供应商、采购单、分批收货、入库和 B2B 协同。', en: 'Manage suppliers, purchase orders, partial receiving, inbound, and B2B links.', vi: 'Quan ly nha cung cap, don mua, nhan tung phan, nhap kho va B2B.' },
    aliases: { zh: ['采购', '供应商', '收货', '入库'], en: ['procurement', 'supplier', 'receiving'], vi: ['mua hang', 'nha cung cap', 'nhan hang'] },
    roles: ['admin', 'manager', 'warehouse', 'finance'],
  },
  audit: {
    id: 'audit',
    group: 'governance',
    icon: ShieldCheck,
    gradient: 'from-slate-700 via-slate-800 to-slate-900',
    accent: 'bg-slate-200',
    ornament: 'dot',
    shortLabel: { zh: '审计日志', en: 'Audit Logs', vi: 'Nhat ky' },
    title: { zh: '系统审计与操作日志', en: 'System Audit and Operation Logs', vi: 'Nhat ky he thong va thao tac' },
    description: { zh: '查看系统操作、权限动作、异常和审计追踪。', en: 'View operations, permission actions, anomalies, and audit trails.', vi: 'Xem thao tac, quyen, bat thuong va dau vet kiem toan.' },
    aliases: { zh: ['审计', '日志', '操作记录'], en: ['audit', 'log'], vi: ['nhat ky', 'kiem toan'] },
    roles: ['admin'],
  },
  settings: {
    id: 'settings',
    group: 'governance',
    icon: Settings,
    gradient: 'from-blue-700 via-slate-700 to-cyan-700',
    accent: 'bg-blue-100',
    ornament: 'ring',
    shortLabel: { zh: '系统设置', en: 'Settings', vi: 'Cai dat' },
    title: { zh: '系统设置与运行治理', en: 'System Settings and Runtime Governance', vi: 'Cai dat he thong va quan tri van hanh' },
    description: { zh: '管理语言、主题、AI 隐私开关和发布前运行治理入口。', en: 'Manage language, theme, AI privacy, and release governance entry points.', vi: 'Quan ly ngon ngu, giao dien, rieng tu AI va diem vao quan tri phat hanh.' },
    aliases: { zh: ['设置', '系统设置', 'AI 设置'], en: ['settings', 'system settings', 'ai settings'], vi: ['cai dat', 'he thong'] },
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

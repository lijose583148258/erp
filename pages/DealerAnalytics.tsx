import React, { useEffect, useState } from 'react';
import { AlertCircle, BarChart3, Database, Link2, PackageCheck, ShieldAlert, Users } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import type { Language } from '../types';
import { dealerAnalyticsService, DealerAnalyticsSnapshot, SalesSegment } from '../services/dealerAnalyticsService';

type Copy = {
  title: string;
  subtitle: string;
  honestState: string;
  honestDetail: string;
  totalDealers: string;
  connectedFeeds: string;
  riskRules: string;
  emptyTitle: string;
  emptyBody: string;
  nextFeeds: string;
  feedCustomer: string;
  feedOrder: string;
  feedCollection: string;
  feedInventory: string;
  feedRisk: string;
  statusNotConnected: string;
};

const COPY: Record<Language, Copy> = {
  zh: {
    title: '内销 / 分销经营分析',
    subtitle: '只展示已接入真实数据的渠道指标；未接入前不使用演示数据代替。',
    honestState: '真实数据未接入',
    honestDetail: '经销商分析需要客户主数据、订单、回款、库存和风险规则共同闭环后才能生成可信报表。',
    totalDealers: '经销商总数',
    connectedFeeds: '已接入数据源',
    riskRules: '已启用风险规则',
    emptyTitle: '暂不展示渠道经营指标',
    emptyBody: '当前页面已保留导航入口和指标结构，但没有用假经销商、假销售额或假库存生成报表。接入真实链路后再开放排行、健康分和行动建议。',
    nextFeeds: '后续需要接入的数据链',
    feedCustomer: '客户 / 供应商统一主数据中的渠道身份',
    feedOrder: '销售订单和发货记录中的内销、分销归属',
    feedCollection: '回款、账期、逾期和信用冻结状态',
    feedInventory: '经销商库存、批次效期和动销记录',
    feedRisk: '授信、坏账、异常库存和负责人变更规则',
    statusNotConnected: '未接入',
  },
  en: {
    title: 'Direct and Channel Sales Analytics',
    subtitle: 'Only connected real data is shown; demo figures are not used as substitutes.',
    honestState: 'Real data not connected',
    honestDetail: 'Dealer analytics needs customer master data, orders, collections, inventory, and risk rules to close the loop before reports are trustworthy.',
    totalDealers: 'Dealers',
    connectedFeeds: 'Connected feeds',
    riskRules: 'Risk rules',
    emptyTitle: 'Channel metrics are not displayed yet',
    emptyBody: 'This page keeps the navigation entry and metric structure, but it no longer fabricates dealer revenue, stock, or scores. Rankings and advice should open only after the real chain is connected.',
    nextFeeds: 'Data feeds required next',
    feedCustomer: 'Channel identity in unified customer and supplier master data',
    feedOrder: 'Direct/channel ownership from sales orders and shipping records',
    feedCollection: 'Collections, terms, overdue status, and credit holds',
    feedInventory: 'Dealer stock, batch expiry, and sell-through records',
    feedRisk: 'Credit, bad debt, abnormal stock, and owner-change rules',
    statusNotConnected: 'Not connected',
  },
  vi: {
    title: 'Phân tích bán trực tiếp và kênh',
    subtitle: 'Chỉ hiển thị dữ liệu thật đã kết nối; không dùng số liệu mẫu để thay thế.',
    honestState: 'Chưa kết nối dữ liệu thật',
    honestDetail: 'Phân tích đại lý cần dữ liệu khách hàng, đơn hàng, thu tiền, tồn kho và quy tắc rủi ro khép kín trước khi báo cáo đáng tin cậy.',
    totalDealers: 'Đại lý',
    connectedFeeds: 'Nguồn đã kết nối',
    riskRules: 'Quy tắc rủi ro',
    emptyTitle: 'Chưa hiển thị chỉ số kênh',
    emptyBody: 'Trang này giữ lại lối vào và cấu trúc chỉ số, nhưng không tạo doanh thu, tồn kho hoặc điểm số giả. Xếp hạng và gợi ý chỉ mở sau khi chuỗi dữ liệu thật được kết nối.',
    nextFeeds: 'Nguồn dữ liệu cần kết nối',
    feedCustomer: 'Định danh kênh trong dữ liệu chủ khách hàng và nhà cung cấp',
    feedOrder: 'Phân tuyến trực tiếp/kênh từ đơn bán và giao hàng',
    feedCollection: 'Thu tiền, kỳ hạn, quá hạn và khóa tín dụng',
    feedInventory: 'Tồn kho đại lý, hạn lô và dữ liệu bán ra',
    feedRisk: 'Tín dụng, nợ xấu, tồn kho bất thường và quy tắc đổi phụ trách',
    statusNotConnected: 'Chưa kết nối',
  },
};

export default function DealerAnalytics() {
  const { language, formatPrice, notify } = useAppContext();
  const copy = COPY[language] || COPY.zh;
  const [snapshot, setSnapshot] = useState<DealerAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dealerAnalyticsService.getSnapshot()
      .then(setSnapshot)
      .catch((error) => notify('error', error instanceof Error ? error.message : '经营数据加载失败'))
      .finally(() => setLoading(false));
  }, [notify]);

  const labels: Record<SalesSegment, Record<Language, string>> = {
    direct: { zh: '内销', en: 'Direct sales', vi: 'Bán trực tiếp' },
    channel: { zh: '分销', en: 'Channel sales', vi: 'Bán qua kênh' },
    mixed: { zh: '混合管理', en: 'Mixed management', vi: 'Quản lý hỗn hợp' },
  };
  const segmentRows = snapshot?.segments || [];
  const totals = snapshot?.totals || { members: 0, customers: 0, orders: 0, revenue: 0 };
  const requiredFeeds = [
    copy.feedCustomer,
    copy.feedOrder,
    copy.feedCollection,
    copy.feedInventory,
    copy.feedRisk,
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-amber-700">
            <AlertCircle size={14} />
            {copy.honestState}
          </div>
          <h1 className="mt-4 text-3xl font-black italic tracking-tight text-slate-900 dark:text-white">
            {copy.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
            {copy.subtitle}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard icon={Users} title={copy.totalDealers} value={loading ? '--' : String(totals.members)} status={loading ? '...' : '实时'} tone="blue" />
        <MetricCard icon={Database} title={copy.connectedFeeds} value="2/5" status="订单 / 客户" tone="emerald" />
        <MetricCard icon={ShieldAlert} title={copy.riskRules} value="0" status={copy.statusNotConnected} tone="amber" />
      </div>

      <section className="overflow-hidden rounded-[18px] border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h2 className="text-base font-black text-slate-900 dark:text-white">内销 / 分销基础经营对比</h2>
          <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">数据来自真实员工归属、客户和销售订单；回款、逾期与渠道库存尚未计入。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                {['业务线', '成员', '客户', '订单', '完成', '订单金额'].map(label => (
                  <th key={label} className="px-4 py-2.5 text-xs font-black text-slate-600 dark:text-slate-300">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {segmentRows.map(row => (
                <tr key={row.key}>
                  <td className="px-4 py-3 text-sm font-black text-slate-900 dark:text-white">{labels[row.key][language]}</td>
                  <td className="px-4 py-3 text-sm font-bold">{row.members}</td>
                  <td className="px-4 py-3 text-sm font-bold">{row.customers}</td>
                  <td className="px-4 py-3 text-sm font-bold">{row.orders}</td>
                  <td className="px-4 py-3 text-sm font-bold">{row.completed}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-black tabular-nums">{formatPrice(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-3 border-t border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30 md:grid-cols-3">
          <SummaryItem label="客户总数" value={totals.customers} />
          <SummaryItem label="订单总数" value={totals.orders} />
          <SummaryItem label="订单总额" value={formatPrice(totals.revenue)} />
        </div>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-slate-100 bg-white/85 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/85">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-[24px] bg-slate-900 text-white shadow-lg shadow-slate-200 dark:bg-blue-600 dark:shadow-none">
            <BarChart3 size={28} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">{copy.emptyTitle}</h2>
            <p className="mt-3 max-w-4xl text-sm font-semibold leading-7 text-slate-500 dark:text-slate-400">
              {copy.emptyBody}
            </p>
            <p className="mt-4 text-sm font-black text-slate-800 dark:text-slate-200">{copy.honestDetail}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <Link2 size={18} />
          </div>
          <h2 className="text-base font-black uppercase tracking-[0.18em] text-slate-800 dark:text-slate-100">
            {copy.nextFeeds}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {requiredFeeds.map((feed) => (
            <div key={feed} className="rounded-2xl border border-white bg-white/80 p-4 text-sm font-bold text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
              {feed}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
      <PackageCheck size={18} className="text-blue-600" />
      <div>
        <div className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</div>
        <div className="mt-0.5 whitespace-nowrap text-lg font-black tabular-nums text-slate-900 dark:text-white">{value}</div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  status,
  tone,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  value: string;
  status: string;
  tone: 'blue' | 'emerald' | 'amber';
}) {
  const toneClass = {
    blue: 'bg-blue-600',
    emerald: 'bg-emerald-600',
    amber: 'bg-amber-500',
  }[tone];

  return (
    <div className="rounded-[28px] border border-slate-100 bg-white/85 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/85">
      <div className="flex items-center justify-between">
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${toneClass} text-white shadow-lg shadow-slate-200/60 dark:shadow-none`}>
          <Icon size={20} />
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          {status}
        </span>
      </div>
      <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-slate-400">{title}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

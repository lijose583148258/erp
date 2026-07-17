import React, { useMemo, useState } from 'react';
import { Brain, CheckCircle2, DatabaseZap, Globe2, LockKeyhole, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import AISettings from '../components/AISettings';

const copy = {
  zh: {
    eyebrow: 'SYSTEM SETTINGS',
    title: '系统设置',
    description: '集中查看语言、主题、AI 与运行治理状态。高风险配置仍通过专用弹窗确认，避免误操作影响业务数据。',
    language: '语言',
    theme: '主题',
    currency: '币种',
    aiTitle: 'AI Settings',
    aiDescription: '外部 AI 默认受隐私开关保护；测试连接和保存配置前需要明确确认。',
    openAi: '打开 AI 设置',
    guardTitle: '发布与运行治理',
    guardDescription: '本地运行包需要通过构建、浏览器审计、性能审计和回读校验后再发布。',
    privacy: '隐私开关',
    readback: '保存后回读',
    runtime: '运行健康检查',
    noDestructive: '此页不执行删除、清库或重置数据操作',
  },
  en: {
    eyebrow: 'SYSTEM SETTINGS',
    title: 'System Settings',
    description: 'Review language, theme, AI, and runtime governance in one place. Risky settings still require a focused confirmation dialog.',
    language: 'Language',
    theme: 'Theme',
    currency: 'Currency',
    aiTitle: 'AI Settings',
    aiDescription: 'External AI is protected by the privacy gate. Connection tests and saves require an explicit decision.',
    openAi: 'Open AI Settings',
    guardTitle: 'Release and Runtime Governance',
    guardDescription: 'Local packages should pass build, browser audit, performance audit, and read-back checks before release.',
    privacy: 'Privacy gate',
    readback: 'Save read-back',
    runtime: 'Runtime health check',
    noDestructive: 'This page does not delete, reset, or purge business data',
  },
  vi: {
    eyebrow: 'SYSTEM SETTINGS',
    title: 'Cai dat he thong',
    description: 'Xem ngon ngu, giao dien, AI va trang thai van hanh trong mot noi. Cau hinh rui ro van can hop thoai xac nhan rieng.',
    language: 'Ngon ngu',
    theme: 'Giao dien',
    currency: 'Tien te',
    aiTitle: 'AI Settings',
    aiDescription: 'AI ben ngoai duoc bao ve boi cong rieng tu. Kiem tra ket noi va luu cau hinh can xac nhan ro rang.',
    openAi: 'Mo AI Settings',
    guardTitle: 'Quan tri phat hanh va van hanh',
    guardDescription: 'Goi chay cuc bo can qua build, browser audit, performance audit va read-back truoc khi phat hanh.',
    privacy: 'Cong rieng tu',
    readback: 'Doc lai sau khi luu',
    runtime: 'Kiem tra runtime',
    noDestructive: 'Trang nay khong xoa, reset hoac don dep du lieu nghiep vu',
  },
} as const;

const statusItems = [
  { icon: ShieldCheck, key: 'privacy' },
  { icon: CheckCircle2, key: 'readback' },
  { icon: DatabaseZap, key: 'runtime' },
] as const;

const Settings: React.FC = () => {
  const { language, theme, currency, t } = useAppContext();
  const [aiOpen, setAiOpen] = useState(false);
  const text = copy[language] || copy.zh;

  const currentState = useMemo(() => ([
    { label: text.language, value: language.toUpperCase(), icon: Globe2 },
    { label: text.theme, value: theme === 'dark' ? 'Dark' : 'Light', icon: SettingsIcon },
    { label: text.currency, value: currency, icon: LockKeyhole },
  ]), [currency, language, text, theme]);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-black tracking-[0.22em] text-blue-600 dark:text-blue-300">{text.eyebrow}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">{text.title}</h1>
            <p className="mt-3 text-sm font-bold leading-7 text-slate-600 dark:text-slate-300">{text.description}</p>
          </div>
          <button
            type="button"
            data-testid="settings-open-ai-settings"
            onClick={() => setAiOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-[20px] bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60"
          >
            <Brain size={18} />
            {text.openAi}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {currentState.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-[24px] border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                  <p className="mt-2 text-lg font-black text-slate-950 dark:text-white">{item.value}</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <Icon size={20} />
                </span>
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[28px] border border-slate-100 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
              <Brain size={22} />
            </span>
            <div>
              <h2 className="text-xl font-black text-slate-950 dark:text-white">{text.aiTitle}</h2>
              <p className="mt-2 text-sm font-bold leading-7 text-slate-600 dark:text-slate-300">{text.aiDescription}</p>
              <p className="mt-3 text-xs font-black text-slate-500 dark:text-slate-400">{t.aiSettings}</p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-100 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xl font-black text-slate-950 dark:text-white">{text.guardTitle}</h2>
          <p className="mt-2 text-sm font-bold leading-7 text-slate-600 dark:text-slate-300">{text.guardDescription}</p>
          <div className="mt-4 space-y-3">
            {statusItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.key} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950/40">
                  <Icon size={18} className="text-emerald-600 dark:text-emerald-300" />
                  <span className="text-sm font-black text-slate-700 dark:text-slate-200">{text[item.key]}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs font-black text-slate-500 dark:text-slate-400">{text.noDestructive}</p>
        </div>
      </section>

      <AISettings isOpen={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
};

export default Settings;

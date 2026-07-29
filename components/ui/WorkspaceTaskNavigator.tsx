import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

type NavigatorVariant = 'blue' | 'amber';
type NavigatorColumns = 'two' | 'three' | 'four';

type NavigatorIcon = ComponentType<LucideProps>;

export interface WorkspaceTaskNavigatorItem<T extends string> {
  id: T;
  title: string;
  subtitle: string;
  purpose: string;
  count?: number | string;
  icon?: NavigatorIcon;
  testId?: string;
}

interface WorkspaceTaskNavigatorProps<T extends string> {
  eyebrow: string;
  title: string;
  description: string;
  items: WorkspaceTaskNavigatorItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  variant?: NavigatorVariant;
  columns?: NavigatorColumns;
  className?: string;
  compact?: boolean;
}

const variantStyles: Record<NavigatorVariant, {
  eyebrow: string;
  active: string;
  inactive: string;
  activeSubtitle: string;
  activePurpose: string;
}> = {
  blue: {
    eyebrow: 'text-blue-500',
    active: 'border-blue-500 bg-blue-600 text-white shadow-2xl shadow-blue-500/25',
    inactive: 'border-slate-100 bg-white/80 text-slate-600 hover:-translate-y-0.5 hover:border-blue-200 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300',
    activeSubtitle: 'text-blue-50',
    activePurpose: 'text-blue-100',
  },
  amber: {
    eyebrow: 'text-amber-500',
    active: 'border-amber-500 bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-2xl shadow-orange-500/25',
    inactive: 'border-slate-100 bg-white/80 text-slate-600 hover:-translate-y-0.5 hover:border-amber-200 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300',
    activeSubtitle: 'text-orange-50',
    activePurpose: 'text-orange-100',
  },
};

const columnStyles: Record<NavigatorColumns, string> = {
  two: 'md:grid-cols-2 xl:min-w-[560px]',
  three: 'md:grid-cols-3 xl:min-w-[660px]',
  four: 'md:grid-cols-2 xl:grid-cols-4',
};

export function WorkspaceTaskNavigator<T extends string>({
  eyebrow,
  title,
  description,
  items,
  activeId,
  onChange,
  variant = 'blue',
  columns = 'three',
  className = '',
  compact = false,
}: WorkspaceTaskNavigatorProps<T>) {
  const styles = variantStyles[variant];

  return (
    <section className={`${compact ? 'rounded-[28px] p-3' : 'rounded-[40px] p-4'} border border-white/60 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/55 ${className}`}>
      <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'} ${columns === 'three' ? 'xl:flex-row xl:items-center xl:justify-between' : ''}`}>
        <div className={compact ? 'px-1' : 'px-2'}>
          <div className={`text-[11px] font-black uppercase tracking-[0.28em] ${styles.eyebrow}`}>{eyebrow}</div>
          <h2 className={`${compact ? 'mt-1 text-lg' : 'mt-2 text-2xl'} font-black tracking-tighter text-slate-950 dark:text-white`}>{title}</h2>
          <p className={`${compact ? 'sr-only' : 'mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-500 dark:text-slate-400'}`}>{description}</p>
        </div>
        <div className={`grid gap-3 ${columnStyles[columns]}`}>
          {items.map(item => {
            const active = activeId === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                data-testid={item.testId}
                type="button"
                onClick={() => onChange(item.id)}
                title={`${item.subtitle}：${item.purpose}`}
                className={`${compact ? 'rounded-[20px] p-3' : 'rounded-[28px] p-4'} border text-left transition-all ${active ? styles.active : styles.inactive}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-black">
                    {Icon ? <Icon size={16} /> : null}
                    {item.title}
                  </span>
                  {item.count !== undefined ? (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {item.count}
                    </span>
                  ) : null}
                </div>
                <div className={`${compact ? 'mt-1' : 'mt-2'} text-xs font-bold leading-5 ${active ? styles.activeSubtitle : 'text-slate-400'}`}>{item.subtitle}</div>
                <div className={`${compact ? 'sr-only' : 'mt-3'} text-[11px] font-bold leading-5 ${active ? styles.activePurpose : 'text-slate-400'}`}>{item.purpose}</div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

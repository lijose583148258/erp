import React, { ErrorInfo } from 'react';
import { AlertOctagon, ChevronDown, RefreshCcw } from 'lucide-react';
import { reportClientIssue } from '../utils/clientIssue';

interface Props {
  children: React.ReactNode;
  pageId?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetail: boolean;
}

type PageErrorFallbackProps = {
  pageId?: string;
  error: Error | null;
  showDetail?: boolean;
  onReload?: () => void;
  onToggleDetail?: () => void;
};

export const PageErrorFallback: React.FC<PageErrorFallbackProps> = ({
  pageId,
  error,
  showDetail = false,
  onReload,
  onToggleDetail,
}) => (
  <section
    className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-800 dark:bg-slate-900/50"
    role="alert"
    aria-live="polite"
  >
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/50">
      <AlertOctagon className="text-rose-500" size={32} aria-hidden="true" />
    </div>

    <div>
      <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">
        {pageId || 'unknown-page'}
      </p>
      <h2 className="text-xl font-black text-slate-800 dark:text-white">当前页面加载失败</h2>
    </div>

    <p className="max-w-md text-sm font-medium leading-6 text-slate-500 dark:text-slate-400">
      该功能模块在加载或运行时遇到异常，其他模块不受影响。你可以重新加载当前页面，或展开错误详情交给维护人员排查。
    </p>

    <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
      <button
        type="button"
        onClick={onReload}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-600/10 transition-colors hover:bg-indigo-700"
      >
        <RefreshCcw size={16} aria-hidden="true" />
        重新加载页面
      </button>
      <button
        type="button"
        onClick={onToggleDetail}
        className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
        aria-expanded={showDetail}
      >
        <ChevronDown size={12} className={`transition-transform duration-200 ${showDetail ? 'rotate-180' : ''}`} aria-hidden="true" />
        {showDetail ? '收起错误详情' : '查看错误详情'}
      </button>
    </div>

    {showDetail && (
      <pre className="max-h-48 w-full max-w-3xl overflow-auto rounded-xl border border-slate-200 bg-slate-100 p-4 text-left font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
        {error?.toString() || 'Unknown error'}
        {'\n\n'}
        {error?.stack || 'No stack available'}
      </pre>
    )}
  </section>
);

class PageErrorBoundary extends React.Component<Props, State> {
  public state: State = { hasError: false, error: null, showDetail: false };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientIssue(`page-error-boundary:${this.props.pageId || 'unknown'}`, {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <PageErrorFallback
          pageId={this.props.pageId}
          error={this.state.error}
          showDetail={this.state.showDetail}
          onReload={() => window.location.reload()}
          onToggleDetail={() => this.setState((state) => ({ showDetail: !state.showDetail }))}
        />
      );
    }

    return this.props.children;
  }
}

export default PageErrorBoundary;

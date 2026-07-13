import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Copy, RefreshCcw } from 'lucide-react';
import { reportClientIssue } from '../utils/clientIssue';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

type RootErrorFallbackProps = {
  error: Error | null;
  componentStack?: string;
  copied?: boolean;
  onReload?: () => void;
  onCopy?: () => void;
};

const getErrorReportText = (error: Error | null, componentStack?: string) => [
  `Error: ${error?.toString() || 'Unknown error'}`,
  '',
  'Component stack:',
  componentStack || 'No component stack available',
].join('\n');

export const RootErrorFallback: React.FC<RootErrorFallbackProps> = ({
  error,
  componentStack,
  copied = false,
  onReload,
  onCopy,
}) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-white">
    <section
      className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20"
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
        <AlertTriangle size={32} aria-hidden="true" />
      </div>

      <h1 className="mb-2 text-2xl font-black">系统遇到错误</h1>
      <p className="mx-auto mb-6 max-w-sm text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
        应用外壳已拦截这次异常，避免整页白屏。请刷新后继续操作；如果问题反复出现，请把错误信息发给维护人员。
      </p>

      <pre className="mb-6 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-slate-100 p-4 text-left text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
        {getErrorReportText(error, componentStack)}
      </pre>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onReload}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <RefreshCcw size={18} aria-hidden="true" />
          重新加载
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          <Copy size={18} aria-hidden="true" />
          {copied ? '已复制' : '复制错误'}
        </button>
      </div>
    </section>
  </div>
);

class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportClientIssue('root-error-boundary', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopy = async () => {
    const text = getErrorReportText(this.state.error, this.state.errorInfo?.componentStack || undefined);
    try {
      await navigator.clipboard?.writeText(text);
      this.setState({ copied: true });
    } catch (error) {
      reportClientIssue('root-error-boundary-copy', error, 'warning');
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <RootErrorFallback
          error={this.state.error}
          componentStack={this.state.errorInfo?.componentStack || undefined}
          copied={this.state.copied}
          onReload={this.handleReload}
          onCopy={this.handleCopy}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

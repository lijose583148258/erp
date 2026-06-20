import React, { ErrorInfo } from 'react';
import { AlertOctagon, RefreshCcw, ChevronDown } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  pageId?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetail: boolean;
}

/**
 * 页面级错误边界组件
 * 用于隔离单个路由页面（如懒加载模块）的崩溃异常，防止单个模块故障导致整个系统白屏。
 */
class PageErrorBoundary extends React.Component<Props, State> {
  public state: State = { hasError: false, error: null, showDetail: false };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PageErrorBoundary] 页面 ${this.props.pageId || 'unknown'} 加载失败:`, error, info);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 p-8 text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
          <div className="w-16 h-16 bg-rose-100 dark:bg-rose-950/50 rounded-full flex items-center justify-center">
            <AlertOctagon className="text-rose-500" size={32} />
          </div>
          <h2 className="text-xl font-black text-slate-800 dark:text-white">
            当前页面加载失败
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm">
            该功能模块在加载或运行中遇到了意外问题，其他模块不受影响。
            请尝试重新加载该页面，若持续失败请联系系统管理员。
          </p>
          
          <div className="flex flex-col sm:flex-row items-center gap-3 mt-2">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-colors shadow-md shadow-indigo-600/10"
            >
              <RefreshCcw size={16} /> 重新加载此页面
            </button>
            <button
              onClick={() => this.setState(s => ({ showDetail: !s.showDetail }))}
              className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1 px-4 py-2 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <ChevronDown size={12} className={`transition-transform duration-200 ${this.state.showDetail ? 'rotate-180' : ''}`} /> 
              {this.state.showDetail ? '折叠错误详情' : '查看错误详情'}
            </button>
          </div>

          {this.state.showDetail && (
            <pre className="text-xs bg-slate-100 dark:bg-slate-800 p-4 rounded-xl max-w-full overflow-auto text-left text-slate-600 dark:text-slate-400 max-h-40 font-mono w-full border border-slate-200 dark:border-slate-700 animate-in slide-in-from-top-2 duration-200">
              {this.state.error?.toString()}
              {"\n\n"}
              {this.state.error?.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default PageErrorBoundary;

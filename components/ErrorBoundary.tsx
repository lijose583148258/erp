import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends React.Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        this.setState({ errorInfo });
    }

    private handleReload = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full border border-slate-100 text-center">
                        <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-6">
                            <AlertTriangle size={32} />
                        </div>

                        <h1 className="text-2xl font-bold text-slate-800 mb-2">系统出现了错误</h1>
                        <p className="text-slate-500 mb-6 text-sm">
                            系统遇到了意外问题，请点击下方按钮重新加载。如问题持续出现，请复制错误堆栈并联系开发人员。
                        </p>

                        <div className="bg-slate-100 rounded-lg p-4 mb-6 text-left overflow-auto max-h-40 text-xs text-slate-600 font-mono">
                            {this.state.error?.toString()}
                        </div>

                        <div className="space-y-2">
                            <button
                                onClick={this.handleReload}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                <RefreshCcw size={18} />
                                重新加载系统
                            </button>

                            <button
                                onClick={() => {
                                    const text = `错误：${this.state.error?.toString()}\n\n堆栈：${this.state.errorInfo?.componentStack || ''}`;
                                    navigator.clipboard?.writeText(text)
                                        .then(() => alert('错误堆栈已复制到剪贴板，请发送给开发人员'))
                                        .catch(() => alert('复制失败，请手动截图或选择复制'));
                                }}
                                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition-colors"
                            >
                                复制错误堆栈信息
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;

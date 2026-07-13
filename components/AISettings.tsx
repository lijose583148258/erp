import React, { useState, useEffect } from 'react';
import {
    Brain, Zap, Check, X, Loader2,
    Eye, EyeOff, AlertCircle
} from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import {
    AI_MODELS,
    AIModelType,
    getAIConfig,
    setCurrentModel,
    updateModelConfig,
    testAIConnection,
    isLocalAIEndpoint
} from '../services/aiConfig';
import { isBrowserExternalAIPolicyEnabled, isExternalAIEnabled, setExternalAIEnabled } from '../services/aiSecurity';

interface AISettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * AI模型设置面板
 * 支持切换不同的免费AI模型
 */
const AISettings: React.FC<AISettingsProps> = ({ isOpen, onClose }) => {
    const { t, notify } = useAppContext();

    const [selectedModel, setSelectedModel] = useState<AIModelType>('local');
    const [apiKey, setApiKey] = useState('');
    const [apiEndpoint, setApiEndpoint] = useState('');
    const [modelName, setModelName] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [externalEnabled, setExternalEnabled] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const browserExternalAllowed = isBrowserExternalAIPolicyEnabled();

    // 加载当前配置
    useEffect(() => {
        if (isOpen) {
            const config = getAIConfig();
            setSelectedModel(config.selectedModel);
            const modelConfig = config.configs[config.selectedModel];
            setApiKey(modelConfig?.apiKey || '');
            setApiEndpoint(modelConfig?.apiEndpoint || '');
            setModelName(modelConfig?.model || '');
            setExternalEnabled(isExternalAIEnabled());
        }
    }, [isOpen]);

    // 切换模型时加载对应配置
    useEffect(() => {
        const config = getAIConfig();
        const modelConfig = config.configs[selectedModel];
        setApiKey(modelConfig?.apiKey || '');
        setApiEndpoint(modelConfig?.apiEndpoint || AI_MODELS.find(m => m.type === selectedModel)?.apiEndpoint || '');
        setModelName(modelConfig?.model || AI_MODELS.find(m => m.type === selectedModel)?.model || '');
        setTestResult(null);
    }, [selectedModel]);

    // 测试连接
    const handleTest = async () => {
        const isLocalOllama = selectedModel === 'ollama' && isLocalAIEndpoint(apiEndpoint);
        if (selectedModel !== 'local' && !isLocalOllama && !externalEnabled) {
            setTestResult({
                success: false,
                message: '外部 AI 当前未启用。请先确认隐私风险后再测试连接。',
            });
            return;
        }

        setIsTesting(true);
        setTestResult(null);

        // 先保存当前配置
        updateModelConfig(selectedModel, { apiKey, apiEndpoint, model: modelName });

        const result = await testAIConnection(selectedModel);
        setTestResult(result);
        setIsTesting(false);
    };

    // 保存配置
    const handleSave = () => {
        setCurrentModel(selectedModel);
        updateModelConfig(selectedModel, { apiKey, apiEndpoint, model: modelName });
        setExternalAIEnabled(externalEnabled);
        notify('success', t.saveConfig + ' 成功');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 w-full max-w-lg mx-4 rounded-[32px] shadow-2xl animate-in zoom-in-95 overflow-hidden">
                {/* 头部 */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center">
                        <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl text-white mr-4">
                            <Brain size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 dark:text-white">{t.aiSettings}</h2>
                            <p className="text-xs text-slate-400 font-bold">{t.aiModel}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full hover:bg-slate-200 transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 模型选择 */}
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        {AI_MODELS.map((model) => (
                            <button
                                key={model.type}
                                onClick={() => setSelectedModel(model.type)}
                                className={`p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${selectedModel === model.type
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                        : 'border-slate-100 dark:border-slate-800 hover:border-slate-200'
                                    }`}
                            >
                                <div className="flex items-center mb-2">
                                    <span className="text-2xl mr-2">{model.icon}</span>
                                    <span className="font-bold text-sm text-slate-800 dark:text-white">{model.name}</span>
                                </div>
                                <p className="text-[10px] text-slate-400 line-clamp-2">{model.description}</p>
                            </button>
                        ))}
                    </div>

                    {/* 配置表单 */}
                    {selectedModel !== 'local' && (
                        <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                                <div className="flex items-start gap-3">
                                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-sm font-black">外部 AI 默认关闭</p>
                                        <p className="mt-1 text-xs font-bold leading-relaxed">
                                            客户、订单、金额、地址、联系人、执照、配方和成本等敏感业务信息不会发送到外部模型。本机 Ollama 可离线使用；远程地址必须先通过隐私闸门。
                                        </p>
                                    </div>
                                </div>
                                <label className="mt-3 flex cursor-pointer items-center justify-between rounded-xl bg-white/70 px-4 py-3 text-xs font-black dark:bg-slate-900/40">
                                    <span>允许外部 AI 连接</span>
                                    <input
                                        type="checkbox"
                                        checked={externalEnabled}
                                        disabled={!browserExternalAllowed}
                                        onChange={(e) => setExternalEnabled(e.target.checked)}
                                        className="h-5 w-5 accent-blue-600"
                                    />
                                </label>
                            </div>

                            {/* API Key */}
                            {selectedModel !== 'ollama' && browserExternalAllowed && (
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-1 block">
                                        {t.apiKey}
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showApiKey ? 'text' : 'password'}
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder="sk-..."
                                            className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 pr-12 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowApiKey(!showApiKey)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        >
                                            {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* API Endpoint */}
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-1 block">
                                    {t.apiEndpoint}
                                </label>
                                <input
                                    type="text"
                                    value={apiEndpoint}
                                    onChange={(e) => setApiEndpoint(e.target.value)}
                                    placeholder="https://..."
                                    className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            </div>

                            {/* 模型名称 */}
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-1 block">
                                    模型名称
                                </label>
                                <input
                                    type="text"
                                    value={modelName}
                                    onChange={(e) => setModelName(e.target.value)}
                                    placeholder="model-name"
                                    className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            </div>

                            {/* 测试结果 */}
                            {testResult && (
                                <div className={`p-3 rounded-xl flex items-center text-sm font-bold ${testResult.success
                                        ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20'
                                        : 'bg-rose-50 text-rose-600 dark:bg-rose-900/20'
                                    }`}>
                                    {testResult.success ? <Check size={16} className="mr-2" /> : <AlertCircle size={16} className="mr-2" />}
                                    {testResult.message}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 本地模式说明 */}
                    {selectedModel === 'local' && (
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                            <div className="flex items-start">
                                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl mr-3">
                                    <Zap size={16} className="text-emerald-600" />
                                </div>
                                <div>
                                    <p className="font-bold text-sm text-slate-700 dark:text-slate-300 mb-1">
                                        {t.aiModelLocal}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        无需 API 密钥，即时响应。使用内置规则引擎解析语音输入，适合基础使用场景。
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 底部操作 */}
                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between gap-3">
                    {selectedModel !== 'local' && (
                        <button
                            onClick={handleTest}
                            disabled={isTesting}
                            className="flex items-center px-6 py-3 bg-slate-200 dark:bg-slate-700 rounded-xl font-bold text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-all active:scale-95 disabled:opacity-50"
                        >
                            {isTesting ? (
                                <Loader2 size={16} className="animate-spin mr-2" />
                            ) : (
                                <Zap size={16} className="mr-2" />
                            )}
                            {t.testConnection}
                        </button>
                    )}
                    <div className="flex-1" />
                    <button
                        onClick={handleSave}
                        className="flex items-center px-8 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-blue-700 transition-all active:scale-95"
                    >
                        <Check size={16} className="mr-2" />
                        {t.saveConfig}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AISettings;


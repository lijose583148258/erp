import React, { useEffect, useState } from 'react';
import { AlertCircle, Brain, Check, Loader2, X, Zap } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import {
  AI_MODELS,
  type AIModelType,
  getAIConfig,
  isLocalAIEndpoint,
  setCurrentModel,
  testAIConnection,
  updateModelConfig,
} from '../services/aiConfig';

interface AISettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const AISettings: React.FC<AISettingsProps> = ({ isOpen, onClose }) => {
  const { t, notify } = useAppContext();
  const [selectedModel, setSelectedModel] = useState<AIModelType>('local');
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [modelName, setModelName] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const config = getAIConfig();
    setSelectedModel(config.selectedModel);
  }, [isOpen]);

  useEffect(() => {
    const config = getAIConfig();
    const saved = config.configs[selectedModel];
    const defaults = AI_MODELS.find(model => model.type === selectedModel);
    setApiEndpoint(saved?.apiEndpoint || defaults?.apiEndpoint || '');
    setModelName(saved?.model || defaults?.model || '');
    setTestResult(null);
  }, [selectedModel]);

  const persistSelection = () => {
    setCurrentModel(selectedModel);
    updateModelConfig(selectedModel, { apiEndpoint, model: modelName });
  };

  const handleTest = async () => {
    if (selectedModel === 'ollama' && !isLocalAIEndpoint(apiEndpoint)) {
      setTestResult({
        success: false,
        message: '浏览器模型只允许连接 localhost、127.0.0.1 或 ::1。',
      });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    updateModelConfig(selectedModel, { apiEndpoint, model: modelName });
    try {
      setTestResult(await testAIConnection(selectedModel));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    persistSelection();
    notify('success', `${t.saveConfig} 成功`);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="mx-4 w-full max-w-lg overflow-hidden rounded-[32px] bg-white shadow-2xl animate-in zoom-in-95 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-slate-800">
          <div className="flex items-center">
            <div className="mr-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 p-3 text-white">
              <Brain size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">{t.aiSettings}</h2>
              <p className="text-xs font-bold text-slate-400">{t.aiModel}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="关闭" className="rounded-full bg-slate-100 p-2 transition-all hover:bg-slate-200 dark:bg-slate-800">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            {AI_MODELS.map(model => (
              <button
                key={model.type}
                onClick={() => setSelectedModel(model.type)}
                className={`rounded-2xl border-2 p-4 text-left transition-all active:scale-95 ${selectedModel === model.type
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-slate-100 hover:border-slate-200 dark:border-slate-800'}`}
              >
                <div className="mb-2 flex items-center">
                  <span className="mr-2 text-2xl">{model.icon}</span>
                  <span className="text-sm font-bold text-slate-800 dark:text-white">{model.name}</span>
                </div>
                <p className="line-clamp-2 text-xs text-slate-400">{model.description}</p>
              </button>
            ))}
          </div>

          {selectedModel === 'ollama' ? (
            <div className="space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="flex items-start gap-3">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-black">浏览器仅允许本机模型</p>
                    <p className="mt-1 text-xs font-bold leading-relaxed">
                      本面板不连接云模型、不保存 API 密钥。外部模型统一经过服务端权限、审计、预算和地址白名单治理。
                    </p>
                  </div>
                </div>
              </div>
              <label className="block">
                <span className="mb-1 ml-2 block text-xs font-black uppercase tracking-widest text-slate-400">{t.apiEndpoint}</span>
                <input value={apiEndpoint} onChange={event => setApiEndpoint(event.target.value)} className="w-full rounded-xl bg-slate-50 px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-100 dark:bg-slate-800" />
              </label>
              <label className="block">
                <span className="mb-1 ml-2 block text-xs font-black uppercase tracking-widest text-slate-400">模型名称</span>
                <input value={modelName} onChange={event => setModelName(event.target.value)} className="w-full rounded-xl bg-slate-50 px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-100 dark:bg-slate-800" />
              </label>
              {testResult && (
                <div className={`flex items-center rounded-xl p-3 text-sm font-bold ${testResult.success
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20'
                  : 'bg-rose-50 text-rose-600 dark:bg-rose-900/20'}`}>
                  {testResult.success ? <Check size={16} className="mr-2" /> : <AlertCircle size={16} className="mr-2" />}
                  {testResult.message}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-start rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
              <div className="mr-3 rounded-xl bg-emerald-100 p-2 dark:bg-emerald-900/30"><Zap size={16} className="text-emerald-600" /></div>
              <div>
                <p className="mb-1 text-sm font-bold text-slate-700 dark:text-slate-300">{t.aiModelLocal}</p>
                <p className="text-xs text-slate-400">无需 API 密钥，即时响应；适合基础操作指引。</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 bg-slate-50 p-6 dark:bg-slate-800/50">
          {selectedModel === 'ollama' && (
            <button onClick={handleTest} disabled={isTesting} className="flex items-center rounded-xl bg-slate-200 px-6 py-3 text-sm font-bold transition-all hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-700">
              {isTesting ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Zap size={16} className="mr-2" />}
              {t.testConnection}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={handleSave} className="flex items-center rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg transition-all hover:bg-blue-700">
            <Check size={16} className="mr-2" />{t.saveConfig}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AISettings;

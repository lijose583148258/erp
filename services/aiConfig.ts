import { reportClientIssue } from '../utils/clientIssue';

export type AIModelType = 'local' | 'ollama';

export interface AIModelConfig {
  type: AIModelType;
  name: string;
  description: string;
  apiEndpoint?: string;
  model?: string;
  isAvailable: boolean;
  icon: string;
}

export const AI_MODELS: AIModelConfig[] = [
  {
    type: 'local',
    name: '本地规则引擎',
    description: '无需联网，默认安全，适合本地 EXE 和离线试运行',
    isAvailable: true,
    icon: 'AI',
  },
  {
    type: 'ollama',
    name: 'Ollama 本地模型',
    description: '只连接本机回环地址，不在浏览器保存云模型密钥',
    apiEndpoint: 'http://localhost:11434/api/generate',
    model: 'qwen2.5:7b',
    isAvailable: false,
    icon: 'OL',
  },
];

const STORAGE_KEY = 'ai_model_config';
const OLLAMA_DEFAULT = {
  apiEndpoint: 'http://localhost:11434/api/generate',
  model: 'qwen2.5:7b',
};

interface AIConfigState {
  selectedModel: AIModelType;
  configs: Record<AIModelType, Partial<AIModelConfig>>;
}

const defaultState: AIConfigState = {
  selectedModel: 'local',
  configs: {
    local: {},
    ollama: { ...OLLAMA_DEFAULT },
  },
};

export const isLocalAIEndpoint = (endpoint?: string): boolean => {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');
  } catch {
    return false;
  }
};

const sanitizeConfig = (value: unknown): AIConfigState => {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const configs = candidate.configs && typeof candidate.configs === 'object'
    ? candidate.configs as Record<string, Record<string, unknown> | undefined>
    : {};
  const ollama = configs.ollama || {};
  const endpoint = typeof ollama.apiEndpoint === 'string' && isLocalAIEndpoint(ollama.apiEndpoint)
    ? ollama.apiEndpoint
    : OLLAMA_DEFAULT.apiEndpoint;
  const model = typeof ollama.model === 'string' && ollama.model.trim()
    ? ollama.model.trim()
    : OLLAMA_DEFAULT.model;

  return {
    selectedModel: candidate.selectedModel === 'ollama' ? 'ollama' : 'local',
    configs: {
      local: {},
      ollama: { apiEndpoint: endpoint, model },
    },
  };
};

export const getAIConfig = (): AIConfigState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultState;
    const sanitized = sanitizeConfig(JSON.parse(stored));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    localStorage.removeItem('ailao.ai.externalEnabled');
    return sanitized;
  } catch (error) {
    reportClientIssue('ai-config-load', error, 'warning');
    return defaultState;
  }
};

export const saveAIConfig = (config: Partial<AIConfigState>): void => {
  try {
    const sanitized = sanitizeConfig({ ...getAIConfig(), ...config });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    localStorage.removeItem('ailao.ai.externalEnabled');
  } catch (error) {
    reportClientIssue('ai-config-save', error);
  }
};

export const getCurrentModel = (): AIModelConfig => {
  const config = getAIConfig();
  const baseModel = AI_MODELS.find(model => model.type === config.selectedModel) || AI_MODELS[0];
  return {
    ...baseModel,
    ...config.configs[config.selectedModel],
    isAvailable: config.selectedModel === 'local'
      || isLocalAIEndpoint(config.configs.ollama.apiEndpoint),
  };
};

export const setCurrentModel = (type: AIModelType): void => {
  saveAIConfig({ selectedModel: type });
};

export const updateModelConfig = (type: AIModelType, config: Partial<AIModelConfig>): void => {
  const current = getAIConfig();
  saveAIConfig({
    ...current,
    configs: {
      ...current.configs,
      [type]: type === 'ollama'
        ? { apiEndpoint: config.apiEndpoint, model: config.model }
        : {},
    },
  });
};

export const testAIConnection = async (type: AIModelType): Promise<{ success: boolean; message: string }> => {
  if (type === 'local') return { success: true, message: '本地规则引擎始终可用' };
  const modelConfig = getAIConfig().configs.ollama;
  const endpoint = modelConfig.apiEndpoint || '';
  if (!isLocalAIEndpoint(endpoint)) {
    return { success: false, message: '浏览器模型只允许连接本机回环地址' };
  }

  try {
    const response = await fetch(endpoint.replace('/api/generate', '/api/tags'), { method: 'GET' });
    return response.ok
      ? { success: true, message: 'Ollama 连接成功' }
      : { success: false, message: 'Ollama 连接失败' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Ollama 连接失败' };
  }
};

const processLocalRules = (input: string): string =>
  `已收到“${input}”。本地规则引擎会优先给出操作入口和安全提示，不展开敏感业务明细。`;

export const callAIModel = async (prompt: string, systemPrompt?: string): Promise<string> => {
  const model = getCurrentModel();
  if (model.type === 'local' || !isLocalAIEndpoint(model.apiEndpoint)) return processLocalRules(prompt);

  try {
    const response = await fetch(model.apiEndpoint!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.model,
        prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
        stream: false,
      }),
    });
    const data = await response.json();
    return data.response || processLocalRules(prompt);
  } catch (error) {
    reportClientIssue('ai-ollama-call', error, 'warning');
    return processLocalRules(prompt);
  }
};

export default {
  AI_MODELS,
  getAIConfig,
  saveAIConfig,
  getCurrentModel,
  setCurrentModel,
  updateModelConfig,
  testAIConnection,
  callAIModel,
  isLocalAIEndpoint,
};

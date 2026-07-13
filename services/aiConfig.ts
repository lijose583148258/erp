import { canSendToExternalAI, isBrowserExternalAIPolicyEnabled } from './aiSecurity';
import { reportClientIssue } from '../utils/clientIssue';

export type AIModelType = 'local' | 'ollama' | 'deepseek' | 'groq' | 'openrouter' | 'custom';

export interface AIModelConfig {
  type: AIModelType;
  name: string;
  description: string;
  apiEndpoint?: string;
  apiKey?: string;
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
    description: '本机部署开源模型，适合内网或离线环境',
    apiEndpoint: 'http://localhost:11434/api/generate',
    model: 'qwen2.5:7b',
    isAvailable: false,
    icon: 'OL',
  },
  {
    type: 'deepseek',
    name: 'DeepSeek',
    description: '外部云模型，必须通过隐私闸门后才允许连接',
    apiEndpoint: 'https://api.chatanywhere.tech/v1/chat/completions',
    model: 'deepseek-v3',
    isAvailable: false,
    icon: 'DS',
  },
  {
    type: 'groq',
    name: 'Groq',
    description: '外部高速推理服务，仅用于非敏感、非业务原文任务',
    apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    isAvailable: false,
    icon: 'GQ',
  },
  {
    type: 'openrouter',
    name: 'OpenRouter',
    description: '外部多模型网关，仅用于非敏感、非业务原文任务',
    apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'mistralai/mistral-7b-instruct:free',
    isAvailable: false,
    icon: 'OR',
  },
  {
    type: 'custom',
    name: '自定义 API',
    description: '兼容 OpenAI 格式的自定义服务；远程地址必须通过隐私闸门',
    isAvailable: false,
    icon: 'API',
  },
];

const STORAGE_KEY = 'ai_model_config';

interface AIConfigState {
  selectedModel: AIModelType;
  configs: Record<AIModelType, Partial<AIModelConfig>>;
}

const defaultState: AIConfigState = {
  selectedModel: 'local',
  configs: {
    local: {},
    ollama: { apiEndpoint: 'http://localhost:11434/api/generate', model: 'qwen2.5:7b' },
    deepseek: { apiEndpoint: 'https://api.chatanywhere.tech/v1/chat/completions', model: 'deepseek-v3' },
    groq: { apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
    openrouter: { apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'mistralai/mistral-7b-instruct:free' },
    custom: {},
  },
};

export const isLocalAIEndpoint = (endpoint?: string): boolean => {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return endpoint.startsWith('/') || endpoint.startsWith('http://localhost') || endpoint.startsWith('http://127.0.0.1');
  }
};

export const getAIConfig = (): AIConfigState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = { ...defaultState, ...JSON.parse(stored) } as AIConfigState;
      if (!isBrowserExternalAIPolicyEnabled()) {
        const configs = Object.fromEntries(Object.entries(parsed.configs).map(([type, config]) => {
          const { apiKey: _discardedApiKey, ...safeConfig } = config || {};
          return [type, safeConfig];
        })) as AIConfigState['configs'];
        const selectedModel = parsed.selectedModel === 'local' || parsed.selectedModel === 'ollama'
          ? parsed.selectedModel
          : 'local';
        const sanitized = { ...parsed, selectedModel, configs };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
        localStorage.setItem('ailao.ai.externalEnabled', 'false');
        return sanitized;
      }
      return parsed;
    }
  } catch (error) {
    reportClientIssue('ai-config-load', error, 'warning');
  }
  return defaultState;
};

export const saveAIConfig = (config: Partial<AIConfigState>): void => {
  try {
    const current = getAIConfig();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...config }));
  } catch (error) {
    reportClientIssue('ai-config-save', error);
  }
};

export const getCurrentModel = (): AIModelConfig => {
  const config = getAIConfig();
  const modelType = config.selectedModel;
  const baseModel = AI_MODELS.find(model => model.type === modelType) || AI_MODELS[0];
  const savedConfig = config.configs[modelType] || {};

  return {
    ...baseModel,
    ...savedConfig,
    isAvailable: modelType === 'local' || modelType === 'ollama' || Boolean(savedConfig.apiKey),
  };
};

export const setCurrentModel = (type: AIModelType): void => {
  saveAIConfig({ selectedModel: type });
};

export const updateModelConfig = (type: AIModelType, config: Partial<AIModelConfig>): void => {
  const safeConfig = !isBrowserExternalAIPolicyEnabled() && type !== 'ollama'
    ? { ...config, apiKey: undefined }
    : config;
  const current = getAIConfig();
  saveAIConfig({
    ...current,
    configs: {
      ...current.configs,
      [type]: { ...current.configs[type], ...safeConfig },
    },
  });
};

const externalSafety = (prompt: string, systemPrompt?: string): { allowed: boolean; message?: string } => {
  const decision = canSendToExternalAI(prompt, systemPrompt);
  if (decision.allowed) return { allowed: true };
  return { allowed: false, message: decision.reason };
};

export const testAIConnection = async (type: AIModelType): Promise<{ success: boolean; message: string }> => {
  const modelConfig = getAIConfig().configs[type] || {};
  const endpoint = modelConfig.apiEndpoint || '';
  const model = modelConfig.model || '';

  if (type === 'local') return { success: true, message: '本地规则引擎始终可用' };

  if (!isLocalAIEndpoint(endpoint)) {
    const safety = externalSafety('AI connection test');
    if (!safety.allowed) return { success: false, message: safety.message || '外部 AI 未通过隐私闸门' };
  }

  if (!modelConfig.apiKey && type !== 'ollama') {
    return { success: false, message: '请先配置 API 密钥' };
  }

  try {
    if (type === 'ollama') {
      const response = await fetch(endpoint.replace('/api/generate', '/api/tags'), { method: 'GET' });
      return response.ok
        ? { success: true, message: 'Ollama 连接成功' }
        : { success: false, message: 'Ollama 连接失败' };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'connection test' }],
        max_tokens: 5,
      }),
    });

    if (response.ok) return { success: true, message: '连接成功' };
    const error = await response.json().catch(() => null);
    return { success: false, message: error?.error?.message || '连接失败' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '连接失败' };
  }
};

const processLocalRules = (input: string): string =>
  `已收到“${input}”。本地规则引擎会优先给出操作入口和安全提示，不展开敏感业务明细。`;

export const callAIModel = async (prompt: string, systemPrompt?: string): Promise<string> => {
  const model = getCurrentModel();

  if (model.type === 'local') return processLocalRules(prompt);

  if (model.type === 'ollama') {
    if (!isLocalAIEndpoint(model.apiEndpoint)) {
      const safety = externalSafety(prompt, systemPrompt);
      if (!safety.allowed) return safety.message || processLocalRules(prompt);
    }

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
  }

  const safety = externalSafety(prompt, systemPrompt);
  if (!safety.allowed) return safety.message || processLocalRules(prompt);

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(model.apiEndpoint!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        messages,
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || processLocalRules(prompt);
  } catch (error) {
    reportClientIssue('ai-api-call', error, 'warning');
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

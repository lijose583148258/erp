import { canSendToExternalAI } from './aiSecurity';
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
        icon: '⌂'
    },
    {
        type: 'deepseek',
        name: 'DeepSeek',
        description: '外部云模型，必须通过隐私闸门后才允许连接',
        apiEndpoint: 'https://api.chatanywhere.tech/v1/chat/completions',
        model: 'deepseek-v3',
        isAvailable: false,
        icon: 'DS'
    },
    {
        type: 'ollama',
        name: 'Ollama 本地模型',
        description: '本机部署 Qwen、Llama 等开源模型，适合内置微模型方向',
        apiEndpoint: 'http://localhost:11434/api/generate',
        model: 'qwen2.5:7b',
        isAvailable: false,
        icon: 'OL'
    },
    {
        type: 'groq',
        name: 'Groq',
        description: '外部高速推理服务，仅用于非敏感、非业务原文任务',
        apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        isAvailable: false,
        icon: 'GQ'
    },
    {
        type: 'openrouter',
        name: 'OpenRouter',
        description: '外部多模型网关，仅用于非敏感、非业务原文任务',
        apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'mistralai/mistral-7b-instruct:free',
        isAvailable: false,
        icon: 'OR'
    },
    {
        type: 'custom',
        name: '自定义 API',
        description: '兼容 OpenAI 格式的自定义服务；远程地址必须通过隐私闸门',
        isAvailable: false,
        icon: 'API'
    }
];

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

const STORAGE_KEY = 'ai_model_config';

interface AIConfigState {
    selectedModel: AIModelType;
    configs: Record<AIModelType, Partial<AIModelConfig>>;
}

const defaultState: AIConfigState = {
    selectedModel: 'local',
    configs: {
        local: {},
        deepseek: { apiEndpoint: 'https://api.chatanywhere.tech/v1/chat/completions', model: 'deepseek-v3' },
        ollama: { apiEndpoint: 'http://localhost:11434/api/generate', model: 'qwen2.5:7b' },
        groq: { apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
        openrouter: { apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'mistralai/mistral-7b-instruct:free' },
        custom: {}
    }
};

export const getAIConfig = (): AIConfigState => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return { ...defaultState, ...JSON.parse(stored) };
        }
    } catch (e) {
        console.warn('Failed to load AI config:', e);
    }
    return defaultState;
};

export const saveAIConfig = (config: Partial<AIConfigState>): void => {
    try {
        const current = getAIConfig();
        const updated = { ...current, ...config };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
        reportClientIssue('ai-config-save', e);
    }
};

export const getCurrentModel = (): AIModelConfig => {
    const config = getAIConfig();
    const modelType = config.selectedModel;
    const baseModel = AI_MODELS.find(m => m.type === modelType) || AI_MODELS[0];
    const customConfig = config.configs[modelType] || {};

    return {
        ...baseModel,
        ...customConfig,
        isAvailable: modelType === 'local' || !!customConfig.apiKey || modelType === 'ollama'
    };
};

export const setCurrentModel = (type: AIModelType): void => {
    saveAIConfig({ selectedModel: type });
};

export const updateModelConfig = (type: AIModelType, config: Partial<AIModelConfig>): void => {
    const current = getAIConfig();
    current.configs[type] = { ...current.configs[type], ...config };
    saveAIConfig(current);
};

const ensureExternalAllowed = (prompt: string, systemPrompt?: string): { allowed: boolean; message?: string } => {
    const safety = canSendToExternalAI(prompt, systemPrompt);
    if (!safety.allowed) {
        console.warn('[AI Safety] External AI call blocked:', safety.reason);
        return { allowed: false, message: safety.reason };
    }
    return { allowed: true };
};

export const testAIConnection = async (type: AIModelType): Promise<{ success: boolean; message: string }> => {
    const config = getAIConfig();
    const modelConfig = config.configs[type];

    if (type === 'local') {
        return { success: true, message: '本地规则引擎始终可用' };
    }

    const endpoint = modelConfig?.apiEndpoint || '';
    const model = modelConfig?.model || '';
    const isLocalEndpoint = isLocalAIEndpoint(endpoint);

    if (!isLocalEndpoint) {
        const safety = ensureExternalAllowed('AI connection test');
        if (!safety.allowed) {
            return { success: false, message: safety.message || '外部 AI 未通过隐私闸门' };
        }
    }

    if (!modelConfig?.apiKey && type !== 'ollama') {
        return { success: false, message: '请先配置 API 密钥' };
    }

    try {
        if (type === 'ollama') {
            const response = await fetch(endpoint.replace('/api/generate', '/api/tags'), {
                method: 'GET',
            });
            if (response.ok) {
                return { success: true, message: 'Ollama 连接成功' };
            }
        } else {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${modelConfig?.apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: 'connection test' }],
                    max_tokens: 5
                })
            });

            if (response.ok) {
                return { success: true, message: '连接成功' };
            }

            const error = await response.json().catch(() => null);
            return { success: false, message: error?.error?.message || '连接失败' };
        }
    } catch (e: any) {
        return { success: false, message: e.message || '连接失败' };
    }

    return { success: false, message: '未知错误' };
};

export const callAIModel = async (
    prompt: string,
    systemPrompt?: string
): Promise<string> => {
    const model = getCurrentModel();

    if (model.type === 'local') {
        return processLocalRules(prompt);
    }

    if (model.type === 'ollama') {
        if (!isLocalAIEndpoint(model.apiEndpoint)) {
            const safety = ensureExternalAllowed(prompt, systemPrompt);
            if (!safety.allowed) return safety.message || processLocalRules(prompt);
        }

        try {
            const response = await fetch(model.apiEndpoint!, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model.model,
                    prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
                    stream: false
                })
            });
            const data = await response.json();
            return data.response || '';
        } catch (e) {
            reportClientIssue('ai-ollama-call', e, 'warning');
            return processLocalRules(prompt);
        }
    }

    const safety = ensureExternalAllowed(prompt, systemPrompt);
    if (!safety.allowed) {
        return safety.message || processLocalRules(prompt);
    }

    try {
        const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const response = await fetch(model.apiEndpoint!, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${model.apiKey}`
            },
            body: JSON.stringify({
                model: model.model,
                messages,
                max_tokens: 1000,
                temperature: 0.3
            })
        });

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    } catch (e) {
        reportClientIssue('ai-api-call', e, 'warning');
        return processLocalRules(prompt);
    }
};

const processLocalRules = (input: string): string => {
    return `已收到“${input}”。本地规则引擎处理中...`;
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
    isLocalAIEndpoint
};

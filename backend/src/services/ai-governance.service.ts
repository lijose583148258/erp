import fs from 'fs';
import { AIAssistInput } from '../validators/ai';
import { AIMetricAction, recordAIMetric } from '../middleware/metricsMiddleware';
import { AIBudgetService } from './ai-budget.service';

type AIActor = {
  role: string;
  segment?: 'direct' | 'channel' | 'mixed';
};

export type AIAssistResult = {
  answer: string;
  mode: 'local' | 'external';
  reason?: 'disabled' | 'sensitive' | 'unconfigured' | 'provider_error' | 'budget_unconfigured' | 'budget_store_unavailable' | 'budget_exhausted' | 'circuit_open';
};

const truthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const list = (value?: string) => String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);

const SENSITIVE_PATTERNS = [
  /customer|client|supplier|vendor|contact|phone|email|address/i,
  /order|contract|invoice|payment|bank|account|amount|price|cost|margin|finance/i,
  /客户|供应商|联系人|电话|邮箱|地址|订单|合同|发票|付款|回款|银行|账号|金额|价格|成本|利润|财务/,
  /khach hang|nha cung cap|lien he|dien thoai|dia chi|don hang|hop dong|thanh toan|tai chinh/i,
];

const HIDDEN_DATA_PATTERNS = [
  /export|dump|list all|all records|full details|show every/i,
  /导出|全部|所有|完整明细|客户名单|供应商名单|联系方式|银行账号/,
  /xuat|tat ca|danh sach|chi tiet day du/i,
];

const localAnswer = (input: AIAssistInput, reason: AIAssistResult['reason']): AIAssistResult => {
  const language = input.language || 'zh-CN';
  const answer = language === 'en-US'
    ? 'The governed assistant can explain workflows and navigation. Open the relevant module to view protected business records according to your role.'
    : language === 'vi-VN'
      ? 'Tro ly duoc quan tri co the huong dan quy trinh va dieu huong. Hay mo phan he tuong ung de xem du lieu nghiep vu theo quyen cua ban.'
      : '受管助手可以说明操作流程和功能入口。具体客户、订单、金额或财务数据，请进入对应模块并按当前角色权限查看。';
  return { answer, mode: 'local', reason };
};

const readSecret = () => {
  try {
    if (process.env.AI_GATEWAY_API_KEY_FILE) {
      return fs.readFileSync(process.env.AI_GATEWAY_API_KEY_FILE, 'utf8').trim();
    }
    return String(process.env.AI_GATEWAY_API_KEY || '').trim();
  } catch {
    return '';
  }
};

const endpointStatus = () => {
  const enabled = truthy(process.env.AI_GATEWAY_EXTERNAL_ENABLED);
  const endpoint = String(process.env.AI_GATEWAY_ENDPOINT || '').trim();
  const model = String(process.env.AI_GATEWAY_MODEL || '').trim();
  let allowed = false;
  try {
    const url = new URL(endpoint);
    const allowedHosts = list(process.env.AI_GATEWAY_ALLOWED_HOSTS);
    const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    allowed = (url.protocol === 'https:' || localHttp) && allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    allowed = false;
  }
  return { enabled, endpoint, model, allowed, configured: enabled && Boolean(endpoint && model && allowed) };
};

export class AIGovernanceService {
  static getStatus() {
    const status = endpointStatus();
    return {
      externalEnabled: status.enabled,
      configured: status.configured && Boolean(readSecret()),
      mode: status.configured && Boolean(readSecret()) ? 'external-allowed' : 'local-only',
      model: status.model || null,
      privacy: 'safe-context-only',
      budget: AIBudgetService.getStatus(),
    };
  }

  static async assist(input: AIAssistInput, actor: AIActor): Promise<AIAssistResult> {
    const startedAt = Date.now();
    const prompt = input.prompt.trim();
    if (HIDDEN_DATA_PATTERNS.some(pattern => pattern.test(prompt)) || SENSITIVE_PATTERNS.some(pattern => pattern.test(prompt))) {
      recordAIMetric('refused_sensitive', Date.now() - startedAt);
      return localAnswer(input, 'sensitive');
    }

    const status = endpointStatus();
    if (!status.enabled) {
      recordAIMetric('fallback_disabled', Date.now() - startedAt);
      return localAnswer(input, 'disabled');
    }
    const apiKey = readSecret();
    if (!status.configured || !apiKey) {
      recordAIMetric('fallback_unconfigured', Date.now() - startedAt);
      return localAnswer(input, 'unconfigured');
    }

    const timeoutMs = Math.min(Math.max(Number(process.env.AI_GATEWAY_TIMEOUT_MS || 12_000), 1_000), 30_000);
    const maxTokens = Math.min(Math.max(Number(process.env.AI_GATEWAY_MAX_TOKENS || 500), 64), 1_000);
    const budget = await AIBudgetService.reserve(maxTokens);
    if (!budget.allowed) {
      recordAIMetric(`fallback_${budget.reason}` as AIMetricAction, Date.now() - startedAt);
      return localAnswer(input, budget.reason);
    }
    const safeContext = {
      language: input.language || 'zh-CN',
      currentPage: input.currentPage || 'unknown',
      visibleCounts: input.visibleCounts || {},
      role: actor.role,
      segment: actor.segment || 'unknown',
    };

    try {
      const response = await fetch(status.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: status.model,
          max_tokens: maxTokens,
          temperature: 0.2,
          messages: [
            { role: 'system', content: 'You are a governed ERP workflow assistant. Never request or reveal protected records. Use only the supplied aggregate context.' },
            { role: 'user', content: `${prompt}\nSafe context: ${JSON.stringify(safeContext)}` },
          ],
        }),
      });
      if (!response.ok) throw new Error(`AI_PROVIDER_HTTP_${response.status}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const answer = String(payload.choices?.[0]?.message?.content || '').trim().slice(0, 4_000);
      if (!answer) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
      await AIBudgetService.recordProviderSuccess();
      recordAIMetric('external_success', Date.now() - startedAt);
      return { answer, mode: 'external' };
    } catch {
      await AIBudgetService.recordProviderFailure();
      recordAIMetric('fallback_provider_error', Date.now() - startedAt);
      return localAnswer(input, 'provider_error');
    }
  }
}

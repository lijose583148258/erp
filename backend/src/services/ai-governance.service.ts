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
  reason?: 'disabled' | 'sensitive' | 'unconfigured' | 'provider_error' | 'unsafe_output' | 'response_too_large' | 'budget_unconfigured' | 'budget_store_unavailable' | 'budget_exhausted' | 'circuit_open';
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

const SENSITIVE_COMPACT_TERMS = [
  'customer', 'client', 'supplier', 'vendor', 'contact', 'phone', 'email', 'address',
  'order', 'contract', 'invoice', 'payment', 'bank', 'account', 'amount', 'price',
  'cost', 'margin', 'finance', '客户', '供应商', '联系人', '电话', '邮箱', '地址',
  '订单', '合同', '发票', '付款', '回款', '银行', '账号', '金额', '价格', '成本',
  '利润', '财务', 'khachhang', 'nhacungcap', 'lienhe', 'dienthoai', 'diachi',
  'donhang', 'hopdong', 'thanhtoan', 'taichinh', 'taikhoan',
];
const SENSITIVE_VALUE_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:\+?\d[\d\s-]{7,}\d)/,
  /\b(?:\d[ -]?){12,19}\b/,
  /(?:[$€£¥￥]\s*\d|\d(?:[\d,.]*\d)?\s*(?:USD|CNY|RMB|EUR|VND)\b)/i,
];
const PROMPT_INJECTION_PATTERNS = [
  /ignore.{0,30}(?:previous|prior|system|developer).{0,30}(?:instruction|message|prompt)/i,
  /(?:reveal|show|print|repeat).{0,30}(?:system|developer).{0,20}(?:instruction|message|prompt)/i,
  /(?:jailbreak|bypass).{0,30}(?:policy|guard|safety|permission)/i,
  /(?:忽略|绕过).{0,20}(?:系统|开发者|安全|权限|规则|指令)/,
  /(?:bo qua|vuot qua).{0,30}(?:he thong|an toan|quyen|chi dan)/i,
];
const normalizeSafetyText = (value: string) => value
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  .toLowerCase();

const containsSensitiveInput = (value: string) => {
  const normalized = normalizeSafetyText(value);
  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, '');
  return HIDDEN_DATA_PATTERNS.some(pattern => pattern.test(normalized))
    || SENSITIVE_PATTERNS.some(pattern => pattern.test(normalized))
    || SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(normalized))
    || PROMPT_INJECTION_PATTERNS.some(pattern => pattern.test(normalized))
    || SENSITIVE_COMPACT_TERMS.some(term => compact.includes(term));
};

const safeCurrentPage = (value?: string) => {
  const page = String(value || '').trim();
  return /^\/?[a-z0-9/_-]{1,120}$/i.test(page) ? page : 'unknown';
};

const UNSAFE_OUTPUT_PATTERNS = [
  /https?:\/\/|www\./i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:\+?\d[\d\s-]{7,}\d)/,
  /\b(?:\d[ -]?){12,19}\b/,
  /(?:[$€£¥￥]\s*\d|\d(?:[\d,.]*\d)?\s*(?:USD|CNY|RMB|EUR|VND)\b)/i,
  /(?:paste|upload|send|share|provide).{0,60}(?:customer|supplier|order|invoice|payment|account|record|data)/i,
  /(?:粘贴|上传|发送|提供).{0,30}(?:客户|供应商|订单|发票|付款|账号|记录|数据)/,
  /(?:dan|tai len|gui|cung cap).{0,60}(?:khach hang|nha cung cap|don hang|thanh toan|tai khoan|du lieu)/i,
  /<\/?(?:script|iframe|object)|javascript:/i,
];

const isUnsafeProviderOutput = (answer: string) => UNSAFE_OUTPUT_PATTERNS.some(pattern => pattern.test(answer));

const readBoundedProviderJson = async (response: Response) => {
  const maxBytes = Math.min(Math.max(Number(process.env.AI_GATEWAY_MAX_RESPONSE_BYTES || 65_536), 8_192), 262_144);
  const declaredHeader = response.headers.get('content-length');
  const declaredBytes = declaredHeader ? Number(declaredHeader) : Number.NaN;
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw new Error('AI_PROVIDER_RESPONSE_TOO_LARGE');
  if (!response.body) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('AI_PROVIDER_RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('AI_PROVIDER_INVALID_JSON');
  }
};

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
    if (containsSensitiveInput(prompt)) {
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
      currentPage: safeCurrentPage(input.currentPage),
      role: actor.role,
      segment: actor.segment || 'unknown',
    };

    try {
      const response = await fetch(status.endpoint, {
        method: 'POST',
        redirect: 'error',
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
      const payload = await readBoundedProviderJson(response) as { choices?: Array<{ message?: { content?: unknown } }> };
      const answer = String(payload.choices?.[0]?.message?.content || '').trim().slice(0, 4_000);
      if (!answer) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
      if (isUnsafeProviderOutput(answer)) throw new Error('AI_PROVIDER_UNSAFE_OUTPUT');
      await AIBudgetService.recordProviderSuccess();
      recordAIMetric('external_success', Date.now() - startedAt);
      return { answer, mode: 'external' };
    } catch (error) {
      await AIBudgetService.recordProviderFailure();
      const code = error instanceof Error ? error.message : '';
      const reason: AIAssistResult['reason'] = code === 'AI_PROVIDER_UNSAFE_OUTPUT'
        ? 'unsafe_output'
        : code === 'AI_PROVIDER_RESPONSE_TOO_LARGE'
          ? 'response_too_large'
          : 'provider_error';
      recordAIMetric(`fallback_${reason}` as AIMetricAction, Date.now() - startedAt);
      return localAnswer(input, reason);
    }
  }
}

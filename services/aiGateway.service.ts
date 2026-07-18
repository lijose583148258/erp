import api from '../utils/api';

export type GovernedAIRequest = {
  prompt: string;
  language?: 'zh-CN' | 'en-US' | 'vi-VN';
  currentPage?: string;
  /** @deprecated Accepted by older servers but never trusted as provider context. */
  visibleCounts?: Record<string, number>;
};

export type GovernedAIResult = {
  answer: string;
  mode: 'local' | 'external';
  reason?: 'disabled' | 'sensitive' | 'unconfigured' | 'provider_error' | 'audit_unavailable' | 'unsafe_output' | 'response_too_large' | 'budget_unconfigured' | 'budget_store_unavailable' | 'budget_exhausted' | 'circuit_open';
};

export const aiGatewayService = {
  async assist(payload: GovernedAIRequest): Promise<GovernedAIResult> {
    const response = await api.post<unknown, { success: boolean; data: GovernedAIResult }>('/ai/assist', payload);
    return response.data;
  },
};

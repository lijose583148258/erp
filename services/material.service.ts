import api, { type ApiRequestOptions } from '../utils/api';

export type MaterialStatus = 'draft' | 'active' | 'blocked' | 'retired';
export type MaterialCategory =
  | 'raw_material'
  | 'finished_good'
  | 'semi_finished'
  | 'packaging'
  | 'consumable'
  | 'service';

export type MaterialAlias = {
  id: number;
  alias: string;
  normalizedAlias: string;
  language: 'zh' | 'en' | 'vi' | 'und';
  aliasType: 'business' | 'supplier' | 'customer' | 'legacy' | 'translation';
};

export type MaterialMaster = {
  id: number;
  code: string;
  nameZh: string;
  nameEn: string | null;
  nameVi: string | null;
  category: MaterialCategory;
  baseUnit: string;
  specification: string | null;
  status: MaterialStatus;
  isTemporary: boolean;
  casNumber: string | null;
  unNumber: string | null;
  hsCode: string | null;
  shelfLifeDays: number | null;
  complianceNotes: string | null;
  aliases: MaterialAlias[];
  createdAt: string;
  updatedAt: string;
};

export type MaterialSearchResult = {
  items: MaterialMaster[];
  total: number;
  limit: number;
  offset: number;
};

export type MaterialListQuery = {
  q?: string;
  status?: MaterialStatus;
  category?: MaterialCategory;
  includeRetired?: boolean;
  limit?: number;
  offset?: number;
};

export type MaterialWriteInput = {
  code: string;
  nameZh: string;
  nameEn?: string | null;
  nameVi?: string | null;
  category: MaterialCategory;
  baseUnit: string;
  specification?: string | null;
  status?: MaterialStatus;
  isTemporary?: boolean;
  casNumber?: string | null;
  unNumber?: string | null;
  hsCode?: string | null;
  shelfLifeDays?: number | null;
  complianceNotes?: string | null;
};

export type BomBackfillSource = {
  materialName: string;
  materialCode: string | null;
  unit: string;
};

export type BomBackfillCandidate = {
  source: BomBackfillSource;
  sourceKey: string;
  occurrenceCount: number;
  expectedFingerprint: string | null;
  overLimit: boolean;
  matchState: 'exact_unique' | 'exact_ambiguous' | 'unit_or_lifecycle_blocked' | 'no_exact_match';
  recommendedMaterialId: number | null;
  suggestions: Array<{
    materialId: number;
    code: string;
    nameZh: string;
    baseUnit: string;
    status: MaterialStatus;
    isTemporary: boolean;
    reason: 'code' | 'name_zh' | 'name_en' | 'name_vi' | 'alias';
    confidence: number;
    unitCompatible: boolean;
    eligible: boolean;
  }>;
  sampleBoms: Array<{ bomNo: string; productName: string; version: string }>;
};

export type BomBackfillCandidateResult = {
  items: BomBackfillCandidate[];
  limit: number;
  offset: number;
  totalUnlinkedItems: number;
  hasMoreGroups: boolean;
  policy: {
    automaticWrite: false;
    exactMatchOnly: true;
    requiresActiveNonTemporaryMaterial: true;
    requiresUnitMatch: true;
    maxChangesPerRun: number;
  };
};

export type MaterialGovernanceRun = {
  id: number;
  runNo: string;
  runType: 'bom_backfill';
  status: 'applied' | 'rolled_back' | 'rollback_blocked';
  summaryJson: string | null;
  createdAt: string;
  appliedAt: string | null;
  rolledBackAt: string | null;
  _count: { changes: number };
};

export type MaterialGovernanceRunResult = {
  items: MaterialGovernanceRun[];
  total: number;
  limit: number;
  offset: number;
};

type MaterialResponse<T> = { success: boolean; data: T; message?: string };

export const materialService = {
  async search(query: string, options: ApiRequestOptions = {}): Promise<MaterialSearchResult> {
    const response = await api.get<never, { success: boolean; data: MaterialSearchResult }>('/materials', {
      params: { q: query, limit: 12 },
      signal: options.signal,
    });
    return response.data;
  },

  async list(query: MaterialListQuery, options: ApiRequestOptions = {}): Promise<MaterialSearchResult> {
    const response = await api.get<never, MaterialResponse<MaterialSearchResult>>('/materials', {
      params: {
        ...query,
        includeRetired: query.includeRetired ? 'true' : undefined,
      },
      signal: options.signal,
    });
    return response.data;
  },

  async create(input: MaterialWriteInput): Promise<MaterialMaster> {
    const response = await api.post<MaterialWriteInput, MaterialResponse<MaterialMaster>>('/materials', input);
    return response.data;
  },

  async update(
    id: number,
    input: Partial<Omit<MaterialWriteInput, 'code'>> & { expectedUpdatedAt: string },
  ): Promise<MaterialMaster> {
    const response = await api.patch<typeof input, MaterialResponse<MaterialMaster>>(`/materials/${id}`, input);
    return response.data;
  },

  async addAlias(
    id: number,
    input: { alias: string; language: MaterialAlias['language']; aliasType: MaterialAlias['aliasType'] },
  ): Promise<MaterialAlias> {
    const response = await api.post<typeof input, MaterialResponse<MaterialAlias>>(`/materials/${id}/aliases`, input);
    return response.data;
  },

  async listBackfillCandidates(
    query: { limit?: number; offset?: number } = {},
    options: ApiRequestOptions = {},
  ): Promise<BomBackfillCandidateResult> {
    const response = await api.get<never, MaterialResponse<BomBackfillCandidateResult>>(
      '/materials/governance/backfill-candidates',
      { params: query, signal: options.signal },
    );
    return response.data;
  },

  async applyBomBackfill(mappings: Array<{
    source: BomBackfillSource;
    materialId: number;
    expectedCount: number;
    expectedFingerprint: string;
  }>): Promise<{ run: MaterialGovernanceRun; idempotent: boolean }> {
    const response = await api.post<
      { mappings: typeof mappings },
      MaterialResponse<{ run: MaterialGovernanceRun; idempotent: boolean }>
    >('/materials/governance/backfill', { mappings });
    return response.data;
  },

  async listGovernanceRuns(
    query: { limit?: number; offset?: number } = {},
    options: ApiRequestOptions = {},
  ): Promise<MaterialGovernanceRunResult> {
    const response = await api.get<never, MaterialResponse<MaterialGovernanceRunResult>>(
      '/materials/governance/runs',
      { params: query, signal: options.signal },
    );
    return response.data;
  },

  async rollbackGovernanceRun(runId: number): Promise<{ run: MaterialGovernanceRun; idempotent: boolean }> {
    const response = await api.post<never, MaterialResponse<{ run: MaterialGovernanceRun; idempotent: boolean }>>(
      `/materials/governance/runs/${runId}/rollback`,
    );
    return response.data;
  },
};

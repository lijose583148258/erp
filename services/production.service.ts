import api, { ApiRequestOptions } from '../utils/api';

export type ProductionWorkOrderStatus = 'draft' | 'planned' | 'in_progress' | 'qc_pending' | 'completed' | 'cancelled';
export type ProductionQualityResult = 'pending' | 'pass' | 'fail';

export interface ProductionSummary {
  bomCount: number;
  workOrderCount: number;
  batchCount: number;
  activeWorkOrders: number;
  completedWorkOrders: number;
  qcPendingCount: number;
  totalTargetQuantity: number;
  totalProducedQuantity: number;
  totalLossQuantity: number;
  passCount: number;
  failCount: number;
  recentWorkOrders: ProductionWorkOrder[];
}

export interface ProductionBomItem {
  id?: number;
  materialName: string;
  materialCode?: string | null;
  ingredientRole?: string | null;
  dosageMode?: string | null;
  percentage?: number | null;
  quantityPerUnit: number;
  unit: string;
  lossRate?: number | null;
  allowedVarianceRate?: number | null;
  processStage?: string | null;
  substituteGroup?: string | null;
  yieldContribution?: number | null;
  notes?: string | null;
}

export interface ProductionBom {
  id: number;
  bomNo: string;
  productName: string;
  version: string;
  bomType?: string;
  status?: string;
  formulationMode?: string | null;
  outputUnit: string;
  standardBatchSize?: number | null;
  batchSizeUnit?: string | null;
  density?: number | null;
  solidContent?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  processJson?: string | null;
  qualitySpecJson?: string | null;
  notes: string | null;
  createdBy: number;
  creator?: { id: number; username: string; role: string } | null;
  items: ProductionBomItem[];
  workOrders?: Array<{
    id: number;
    workOrderNo: string;
    status: ProductionWorkOrderStatus;
    targetQuantity: number;
    producedQuantity: number;
    lossQuantity: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionStep {
  id: number;
  workOrderId: number;
  stepNo: number;
  title: string;
  status: string;
  operatorName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionQualityCheck {
  id: number;
  workOrderId: number;
  checkNo: string;
  result: ProductionQualityResult;
  defectRate: number | null;
  note: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionWorkOrder {
  id: number;
  workOrderNo: string;
  bomId: number | null;
  batchId: number | null;
  productName: string;
  targetQuantity: number;
  producedQuantity: number;
  lossQuantity: number;
  status: ProductionWorkOrderStatus;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  note: string | null;
  createdBy: number;
  bom?: { id: number; bomNo: string; productName: string; version: string; outputUnit: string } | null;
  productBatch?: { id: number; batchNo: string; productName: string; stockQuantity: number; unit: string } | null;
  steps: ProductionStep[];
  qualityChecks: ProductionQualityCheck[];
  createdAt: string;
  updatedAt: string;
}

export const productionService = {
  async getSummary(options: ApiRequestOptions = {}): Promise<ProductionSummary> {
    const response = await api.get<any, { success: boolean; data: ProductionSummary }>('/production/summary', { signal: options.signal });
    return response.data;
  },

  async getBoms(options: ApiRequestOptions = {}): Promise<ProductionBom[]> {
    const response = await api.get<any, { success: boolean; data: ProductionBom[] }>('/production/boms', { signal: options.signal });
    return response.data || [];
  },

  async createBom(data: {
    productName: string;
    version?: string | null;
    bomType?: string | null;
    status?: string | null;
    formulationMode?: string | null;
    outputUnit: string;
    standardBatchSize?: number | null;
    batchSizeUnit?: string | null;
    density?: number | null;
    solidContent?: number | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    processJson?: string | null;
    qualitySpecJson?: string | null;
    notes?: string | null;
    items?: ProductionBomItem[];
  }): Promise<ProductionBom> {
    const response = await api.post<any, { success: boolean; data: ProductionBom }>('/production/boms', data);
    return response.data;
  },

  async getWorkOrders(params?: { status?: string; bomId?: number; batchId?: number; keyword?: string }, options: ApiRequestOptions = {}): Promise<ProductionWorkOrder[]> {
    const response = await api.get<any, { success: boolean; data: ProductionWorkOrder[] }>('/production/work-orders', { params, signal: options.signal });
    return response.data || [];
  },

  async createWorkOrder(data: {
    bomId?: number | null;
    batchId?: number | null;
    productName: string;
    targetQuantity: number;
    producedQuantity?: number | null;
    lossQuantity?: number | null;
    plannedStartAt?: string | null;
    plannedEndAt?: string | null;
    note?: string | null;
    steps?: Array<{ stepNo?: number; title: string; operatorName?: string | null; note?: string | null }>;
  }): Promise<ProductionWorkOrder> {
    const response = await api.post<any, { success: boolean; data: ProductionWorkOrder }>('/production/work-orders', data);
    return response.data;
  },

  async previewWorkOrderConsumption(id: number): Promise<any> {
    const response = await api.get<any, { success: boolean; data: any }>(`/production/work-orders/${id}/preview-consumption`);
    return response.data;
  },

  async updateWorkOrderStatus(id: number, status: ProductionWorkOrderStatus, consumptionRecords?: { stockBalanceId: number; quantity: number }[]): Promise<ProductionWorkOrder> {
    const response = await api.patch<any, { success: boolean; data: ProductionWorkOrder }>(`/production/work-orders/${id}/status`, { status, consumptionRecords });
    return response.data;
  },

  async updateStep(id: number, stepId: number, data: { status?: string; operatorName?: string | null; note?: string | null }): Promise<ProductionStep> {
    const response = await api.patch<any, { success: boolean; data: ProductionStep }>(`/production/work-orders/${id}/steps/${stepId}`, data);
    return response.data;
  },

  async createQualityCheck(id: number, data: { result: ProductionQualityResult; defectRate?: number | null; note?: string | null; checkedBy?: string | null }): Promise<ProductionQualityCheck> {
    const response = await api.post<any, { success: boolean; data: ProductionQualityCheck }>(`/production/work-orders/${id}/checks`, data);
    return response.data;
  },
};


import api from '../utils/api';

export type DensityInput = {
  batchNo: string; specCode: string; version: string;
  densityKgPerL: string; temperatureC: string; pressureKpaAbs: string;
  compositionReference: string; methodReference: string; sourceReference: string; measuredAt: string;
};
export type DensityRevision = DensityInput & {
  id: number; materialId: number; batchId: number; baseUnit: string; status: string;
  createdBy: number; approvedBy: number | null; approvedAt: string | null;
  reviewReason: string | null; retireReason: string | null; updatedAt: string;
};
type Response<T> = { success: boolean; data: T };
export const materialDensityService = {
  async list(materialId: number): Promise<DensityRevision[]> {
    return (await api.get<never,Response<DensityRevision[]>>(`/materials/${materialId}/densities`)).data;
  },
  async create(materialId: number, input: DensityInput): Promise<DensityRevision> {
    return (await api.post<DensityInput,Response<DensityRevision>>(`/materials/${materialId}/densities`,input)).data;
  },
  async review(row: DensityRevision, action: 'approve' | 'retire', reason: string): Promise<DensityRevision> {
    const body = { expectedUpdatedAt: row.updatedAt, reason };
    return (await api.post<typeof body,Response<DensityRevision>>(`/materials/${row.materialId}/densities/${row.id}/${action}`,body)).data;
  },
};

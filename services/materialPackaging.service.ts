import api from '../utils/api';

export type PackagingRevisionInput = { specCode: string; version: string; packageUnit: string; netMass: string; massUnit: string; sourceReference: string };
export type PackagingRevision = PackagingRevisionInput & { id: number; materialId: number; status: string; createdBy: number; approvedBy: number | null; approvedAt: string | null; updatedAt: string };
type Response<T> = { success: boolean; data: T };
export const materialPackagingService = {
  async list(materialId: number): Promise<PackagingRevision[]> {
    return (await api.get<never,Response<PackagingRevision[]>>(`/materials/${materialId}/packaging`)).data;
  },
  async create(materialId: number, input: PackagingRevisionInput): Promise<PackagingRevision> {
    return (await api.post<PackagingRevisionInput,Response<PackagingRevision>>(`/materials/${materialId}/packaging`, input)).data;
  },
  async review(r: PackagingRevision, action: 'approve' | 'retire', reason: string): Promise<PackagingRevision> {
    const input = { expectedUpdatedAt: r.updatedAt, reason };
    return (await api.post<typeof input,Response<PackagingRevision>>(`/materials/${r.materialId}/packaging/${r.id}/${action}`,input)).data;
  },
};

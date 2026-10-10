import api from '../utils/api';
import type { SalesOrder } from '../types';

export type SalesFulfillmentPlanInput = {
  idempotencyKey: string; orderItemId: number; fulfillmentOption: 'linked_purchase';
  sourceDocumentId: number; plannedQuantity: number; expectedFulfillmentAt: string; note: string;
};
export type SalesFulfillmentPlan = SalesFulfillmentPlanInput & {
  id: number; orderId: number; planNo: string; status: string; unit: string; createdBy: number;
  approvedBy: number | null; closedBy: number | null; updatedAt: string;
  sourceSnapshot: { id: number; revision: number; quantity: number; unit: string; eta: string };
  closeoutSnapshot: null | { receivedQuantity: number; deliveredFromSource: number; committedQuantity: number };
};
export type SalesFulfillmentPlans = {
  plans: SalesFulfillmentPlan[]; fulfillment: NonNullable<SalesOrder['fulfillment']>;
  scope: 'linked_purchase_only'; physicalStockReserved: false; confirmationGateEnforced: false;
};
type Response<T> = { success: boolean; data: T };
const base = (orderId: string | number) => `/orders/${orderId}/fulfillment-plans`;
export const salesFulfillmentPlanService = {
  async list(orderId: string | number) {
    return (await api.get<never, Response<SalesFulfillmentPlans>>(base(orderId))).data;
  },
  async create(orderId: string | number, input: SalesFulfillmentPlanInput) {
    return (await api.post<typeof input, Response<SalesFulfillmentPlan>>(base(orderId), input)).data;
  },
  async approve(plan: SalesFulfillmentPlan, reason: string) {
    const input = { expectedUpdatedAt: plan.updatedAt, reason };
    return (await api.post<typeof input, Response<SalesFulfillmentPlan>>(`${base(plan.orderId)}/${plan.id}/approve`, input)).data;
  },
  async close(plan: SalesFulfillmentPlan, reason: string, idempotencyKey: string) {
    const input = { reason, idempotencyKey };
    return (await api.post<typeof input, Response<SalesFulfillmentPlan>>(`${base(plan.orderId)}/${plan.id}/close`, input)).data;
  },
};

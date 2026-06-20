import { AuthRequest } from '../middleware/auth';
import {
  ProductionBomInput,
  ProductionQualityCheckInput,
  ProductionQualityResult,
  ProductionWorkOrderInput,
  ProductionWorkOrderStatus,
  ProductionWorkOrderStepInput,
} from './production-query.service';
import { ProductionQueryService } from './production-query.service';
import { ProductionMutationService } from './production-mutation.service';
import { ProductionCostLedgerService } from './production-cost-ledger.service';

export type { ProductionWorkOrderStatus, ProductionQualityResult, ProductionBomInput, ProductionBomItemInput, ProductionWorkOrderInput, ProductionWorkOrderStepInput, ProductionQualityCheckInput } from './production-query.service';

export class ProductionService {
  static async getSummary() {
    return ProductionQueryService.getSummary();
  }

  static async listBoms() {
    return ProductionQueryService.listBoms();
  }

  static async listWorkOrders(filters: { status?: string; bomId?: number; batchId?: number; keyword?: string } = {}) {
    return ProductionQueryService.listWorkOrders(filters);
  }

  static async createBom(input: ProductionBomInput, createdBy: number) {
    return ProductionMutationService.createBom(input, createdBy);
  }

  static async createWorkOrder(input: ProductionWorkOrderInput, createdBy: number) {
    return ProductionMutationService.createWorkOrder(input, createdBy);
  }

  static async updateWorkOrderStatus(id: number, status: ProductionWorkOrderStatus, consumptionRecords?: { stockBalanceId: number; quantity: number }[]) {
    return ProductionMutationService.updateWorkOrderStatus(id, status, consumptionRecords);
  }

  static async previewWorkOrderConsumption(workOrderId: number) {
    return ProductionQueryService.previewWorkOrderConsumption(workOrderId);
  }

  static async updateWorkOrderStep(workOrderId: number, stepId: number, input: { status?: string; operatorName?: string | null; note?: string | null }) {
    return ProductionMutationService.updateWorkOrderStep(workOrderId, stepId, input);
  }

  static async createQualityCheck(workOrderId: number, input: ProductionQualityCheckInput) {
    return ProductionMutationService.createQualityCheck(workOrderId, input);
  }

  static async getBatchCostLedger(batchId: number, options: { page?: number; pageSize?: number } = {}) {
    return ProductionCostLedgerService.listByBatchId(batchId, options);
  }
}

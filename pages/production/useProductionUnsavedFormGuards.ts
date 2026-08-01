import { useUnsavedForm } from '../../app/useUnsavedForm';
import type {
  useProductionAdjustmentForm,
  useProductionBomForm,
  useProductionQualityForm,
  useProductionWorkOrderForm,
} from './useProductionWorkspaceForms';
import type { ProductionDeskTab } from './productionWorkspaceConfig';

type ProductionUnsavedFormGuardParams = {
  bomForm: ReturnType<typeof useProductionBomForm>;
  workOrderForm: ReturnType<typeof useProductionWorkOrderForm>;
  qualityForm: ReturnType<typeof useProductionQualityForm>;
  adjustmentForm: ReturnType<typeof useProductionAdjustmentForm>;
  bomSaveVersion: number;
  workOrderSaveVersion: number;
  qualitySaveVersion: number;
  adjustmentSaveVersion: number;
  autoFilledWorkOrderProduct: string;
  activeDeskTab: ProductionDeskTab;
  hasSelectedWorkOrder: boolean;
};

export const useProductionUnsavedFormGuards = ({
  bomForm,
  workOrderForm,
  qualityForm,
  adjustmentForm,
  bomSaveVersion,
  workOrderSaveVersion,
  qualitySaveVersion,
  adjustmentSaveVersion,
  autoFilledWorkOrderProduct,
  activeDeskTab,
  hasSelectedWorkOrder,
}: ProductionUnsavedFormGuardParams) => {
  useUnsavedForm({
    sourceId: 'production-bom-form',
    label: '\u751f\u4ea7 BOM \u914d\u65b9',
    open: true,
    enabled: activeDeskTab === 'bom',
    touched: bomForm.touched,
    resetKey: bomSaveVersion,
    value: {
      bomProductName: bomForm.bomProductName,
      bomVersion: bomForm.bomVersion,
      bomType: bomForm.bomType,
      bomStatus: bomForm.bomStatus,
      bomFormulationMode: bomForm.bomFormulationMode,
      bomOutputUnit: bomForm.bomOutputUnit,
      bomShelfLifeDays: bomForm.bomShelfLifeDays,
      bomStandardBatchSize: bomForm.bomStandardBatchSize,
      bomBatchSizeUnit: bomForm.bomBatchSizeUnit,
      bomDensity: bomForm.bomDensity,
      bomSolidContent: bomForm.bomSolidContent,
      bomEffectiveFrom: bomForm.bomEffectiveFrom,
      bomEffectiveTo: bomForm.bomEffectiveTo,
      bomProcessText: bomForm.bomProcessText,
      bomQualitySpecText: bomForm.bomQualitySpecText,
      bomNotes: bomForm.bomNotes,
      bomItems: bomForm.bomItems,
    },
  });

  useUnsavedForm({
    sourceId: 'production-work-order-form',
    label: '\u751f\u4ea7\u5de5\u5355',
    open: true,
    enabled: activeDeskTab === 'workOrders',
    touched: workOrderForm.touched,
    resetKey: workOrderSaveVersion,
    value: {
      productName: workOrderForm.woProductName === autoFilledWorkOrderProduct ? '' : workOrderForm.woProductName,
      woTargetQuantity: workOrderForm.woTargetQuantity,
      woProducedQuantity: workOrderForm.woProducedQuantity,
      woLossQuantity: workOrderForm.woLossQuantity,
      woPlannedStartAt: workOrderForm.woPlannedStartAt,
      woPlannedEndAt: workOrderForm.woPlannedEndAt,
      woNote: workOrderForm.woNote,
      woSteps: workOrderForm.woSteps,
    },
  });

  useUnsavedForm({
    sourceId: 'production-quality-form',
    label: '\u751f\u4ea7\u8d28\u68c0\u8bb0\u5f55',
    open: true,
    enabled: activeDeskTab === 'workOrders' && hasSelectedWorkOrder,
    touched: qualityForm.touched,
    resetKey: qualitySaveVersion,
    value: {
      qcSampleNo: qualityForm.qcSampleNo,
      qcMeasurementValues: qualityForm.qcMeasurementValues,
      qcInstrumentNumbers: qualityForm.qcInstrumentNumbers,
      qcNote: qualityForm.qcNote,
      qcReviewNote: qualityForm.qcReviewNote,
    },
  });

  useUnsavedForm({
    sourceId: 'production-batch-adjustment-form',
    label: '\u751f\u4ea7\u6279\u6b21\u5f02\u5e38\u8c03\u6574',
    open: true,
    enabled: activeDeskTab === 'batches',
    touched: adjustmentForm.touched,
    resetKey: adjustmentSaveVersion,
    value: {
      templateId: adjustmentForm.templateId,
      adjustmentQuantity: adjustmentForm.adjustmentQuantity,
      adjustmentReason: adjustmentForm.adjustmentReason,
      adjustmentNote: adjustmentForm.adjustmentNote,
    },
  });
};

import { useUnsavedForm } from '../../app/useUnsavedForm';
import type {
  useProductionAdjustmentForm,
  useProductionBomForm,
  useProductionQualityForm,
  useProductionWorkOrderForm,
} from './useProductionWorkspaceForms';

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
}: ProductionUnsavedFormGuardParams) => {
  useUnsavedForm({
    sourceId: 'production-bom-form',
    label: '生产 BOM 配方',
    open: true,
    resetKey: bomSaveVersion,
    value: {
      bomProductName: bomForm.bomProductName,
      bomVersion: bomForm.bomVersion,
      bomType: bomForm.bomType,
      bomStatus: bomForm.bomStatus,
      bomFormulationMode: bomForm.bomFormulationMode,
      bomOutputUnit: bomForm.bomOutputUnit,
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
    label: '生产工单',
    open: true,
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
    label: '生产质检记录',
    open: true,
    resetKey: qualitySaveVersion,
    value: {
      qcResult: qualityForm.qcResult,
      qcDefectRate: qualityForm.qcDefectRate,
      qcNote: qualityForm.qcNote,
      qcCheckedBy: qualityForm.qcCheckedBy,
    },
  });

  useUnsavedForm({
    sourceId: 'production-batch-adjustment-form',
    label: '生产批次异常调整',
    open: true,
    resetKey: adjustmentSaveVersion,
    value: {
      templateId: adjustmentForm.templateId,
      adjustmentQuantity: adjustmentForm.adjustmentQuantity,
      adjustmentReason: adjustmentForm.adjustmentReason,
      adjustmentNote: adjustmentForm.adjustmentNote,
    },
  });
};

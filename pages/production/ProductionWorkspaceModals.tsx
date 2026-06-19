import type { AdjustmentRecord } from '../../services/adjustment.service';
import type { ProductionWorkOrder } from '../../services/production.service';
import { CompleteWorkOrderModal } from './CompleteWorkOrderModal';
import { ProductionAdjustmentReverseDialog } from './ProductionAdjustmentReverseDialog';

type ProductionWorkspaceModalsProps = {
  showCompleteModal: boolean;
  completingWorkOrder: ProductionWorkOrder | null;
  reverseAdjustment: AdjustmentRecord | null;
  reverseSubmitting: boolean;
  onCloseComplete: () => void;
  onConfirmComplete: (consumptionRecords: { stockBalanceId: number; quantity: number }[]) => Promise<void>;
  onCancelReverse: () => void;
  onConfirmReverse: (note: string) => Promise<void>;
};

export const ProductionWorkspaceModals = ({
  showCompleteModal,
  completingWorkOrder,
  reverseAdjustment,
  reverseSubmitting,
  onCloseComplete,
  onConfirmComplete,
  onCancelReverse,
  onConfirmReverse,
}: ProductionWorkspaceModalsProps) => (
  <>
    {showCompleteModal && completingWorkOrder ? (
      <CompleteWorkOrderModal
        workOrderId={completingWorkOrder.id}
        productName={completingWorkOrder.productName}
        targetQuantity={Number(completingWorkOrder.targetQuantity || 0)}
        onClose={onCloseComplete}
        onConfirm={onConfirmComplete}
      />
    ) : null}
    <ProductionAdjustmentReverseDialog
      record={reverseAdjustment}
      loading={reverseSubmitting}
      onCancel={onCancelReverse}
      onConfirm={onConfirmReverse}
    />
  </>
);

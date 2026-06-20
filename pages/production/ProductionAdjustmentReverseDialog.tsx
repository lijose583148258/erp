import type { FC } from 'react';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import type { AdjustmentRecord } from '../../services/adjustment.service';

type ProductionAdjustmentReverseDialogProps = {
  record: AdjustmentRecord | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
};

export const ProductionAdjustmentReverseDialog: FC<ProductionAdjustmentReverseDialogProps> = ({
  record,
  loading,
  onCancel,
  onConfirm,
}) => (
  <ReasonDialog
    testId="production-adjustment-reverse-dialog"
    open={Boolean(record)}
    title={record ? `冲销生产调账 ${record.adjustmentNo || record.targetRef || record.id}` : '冲销生产调账'}
    description="生产调账会影响批次库存和后续成本核算，请填写冲销说明，确保仓储、生产、财务能追溯同一原因。"
    defaultReason="生产调账冲销"
    confirmLabel="确认冲销"
    tone="danger"
    loading={loading}
    onCancel={onCancel}
    onConfirm={onConfirm}
  />
);

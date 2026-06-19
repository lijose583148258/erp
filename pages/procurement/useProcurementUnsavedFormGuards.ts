import { useUnsavedForm } from '../../app/useUnsavedForm';
import type { NewPurchaseOrderForm, NewSupplierForm } from './procurementForms';

type ProcurementUnsavedFormGuardParams = {
  supplierSaveVersion: number;
  orderSaveVersion: number;
  newSupplier: NewSupplierForm;
  newOrder: NewPurchaseOrderForm;
  isB2B: boolean;
};

export const useProcurementUnsavedFormGuards = ({
  supplierSaveVersion,
  orderSaveVersion,
  newSupplier,
  newOrder,
  isB2B,
}: ProcurementUnsavedFormGuardParams) => {
  useUnsavedForm({
    sourceId: 'procurement-supplier-form',
    label: '供应商主数据',
    open: true,
    resetKey: supplierSaveVersion,
    value: newSupplier,
  });

  useUnsavedForm({
    sourceId: 'procurement-order-form',
    label: '采购订单',
    open: true,
    resetKey: orderSaveVersion,
    value: { ...newOrder, isB2B },
  });
};

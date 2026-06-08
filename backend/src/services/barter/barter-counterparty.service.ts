import prisma from '../../config/database';
import type { BarterCounterpartyType } from './barter.types';
import { resolveCounterpartyIds } from './barter.formatters';

export async function validateCounterpartyAndOrderLinks(input: {
  counterpartyType: BarterCounterpartyType;
  customerId?: number | null;
  supplierId?: number | null;
  orderId?: number | null;
}) {
  const { customerId, supplierId } = resolveCounterpartyIds(input);

  if (input.counterpartyType === 'customer' && !customerId) {
    throw new Error('Customer is required for customer barter settlement');
  }

  if (input.counterpartyType === 'supplier' && !supplierId) {
    throw new Error('Supplier is required for supplier barter settlement');
  }

  if (customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });

    if (!customer) {
      throw new Error('未找到货抵客户，请刷新后重新选择。');
    }
  }

  if (supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });

    if (!supplier) {
      throw new Error('未找到货抵供应商，请刷新后重新选择。');
    }
  }

  if (input.orderId) {
    const linkedOrder = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        customerId: true,
        status: true,
      },
    });

    if (!linkedOrder) {
      throw new Error('关联订单不存在，请刷新后重新选择。');
    }

    if (linkedOrder.status === 'cancelled') {
      throw new Error('Cancelled order cannot be linked to barter settlement');
    }

    if (customerId && linkedOrder.customerId !== customerId) {
      throw new Error('关联订单不属于所选客户。');
    }
  }

  return { customerId, supplierId };
}

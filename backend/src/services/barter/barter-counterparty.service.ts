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
      throw new Error('Customer not found for barter settlement');
    }
  }

  if (supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });

    if (!supplier) {
      throw new Error('Supplier not found for barter settlement');
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
      throw new Error('Linked order not found');
    }

    if (linkedOrder.status === 'cancelled') {
      throw new Error('Cancelled order cannot be linked to barter settlement');
    }

    if (customerId && linkedOrder.customerId !== customerId) {
      throw new Error('Linked order does not belong to the selected customer');
    }
  }

  return { customerId, supplierId };
}

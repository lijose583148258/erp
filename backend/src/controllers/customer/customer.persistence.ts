import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import { serializeCustomerAddresses } from '../../utils/customerAddressV2';
import { buildCustomerWhere } from './customer.access';
import { buildOrderStats, serializeCustomerContacts } from './customer.payload';
import { CustomerOrderStats } from './customer.types';

type CustomerOrderStatSource = Parameters<typeof buildOrderStats>[0][number];
type CustomerAddressesInput = Parameters<typeof serializeCustomerAddresses>[0];

let customerContactsColumnReady: Promise<void> | null = null;

export async function loadCustomerForRequest(req: AuthRequest, id: number) {
  const customer = await prisma.customer.findFirst({
    where: buildCustomerWhere(req, { id }),
    include: {
      salesperson: { select: { id: true, username: true } },
      poolUpdatedByUser: { select: { id: true, username: true } },
    },
  });

  if (!customer) {
    return null;
  }

  const [addressMap, contactMap] = await Promise.all([
    loadCustomerAddressMap([customer.id]),
    loadCustomerContactMap([customer.id]),
  ]);
  const addressRow = addressMap.get(customer.id);
  const contactRow = contactMap.get(customer.id);

  return {
    ...customer,
    address: addressRow?.address ?? customer.address ?? null,
    addressesJson: addressRow?.addressesJson ?? null,
    contactsJson: contactRow?.contactsJson ?? null,
  };
}

export function parseAuditDetails(details: string | null | undefined) {
  if (!details) return {};
  try {
    return JSON.parse(details);
  } catch {
    return { rawDetails: details };
  }
}

export async function writeCustomerAuditLog(data: {
  userId: number;
  action: string;
  resourceId?: number;
  details: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        resource: 'customer',
        resourceId: data.resourceId,
        details: data.details,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  } catch (auditError) {
    logger.warn('客户审计记录失败，但业务操作已保留', auditError);
  }
}

export async function loadOrderStats(customerIds: number[]) {
  if (customerIds.length === 0) {
    return new Map<number, CustomerOrderStats>();
  }

  const orders = await prisma.order.findMany({
    where: {
      customerId: { in: customerIds },
      status: { not: 'cancelled' },
    },
    select: {
      customerId: true,
      createdAt: true,
      paymentTerms: true,
      finalAmount: true,
      paidAmount: true,
      receivableAdjustmentAmount: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const grouped = new Map<number, CustomerOrderStatSource[]>();
  for (const order of orders) {
    const list = grouped.get(order.customerId) || [];
    list.push(order);
    grouped.set(order.customerId, list);
  }

  const statsMap = new Map<number, CustomerOrderStats>();
  for (const [customerId, list] of grouped.entries()) {
    statsMap.set(customerId, buildOrderStats(list));
  }

  return statsMap;
}

async function ensureCustomerContactsColumn() {
  if (!customerContactsColumnReady) {
    customerContactsColumnReady = (async () => {
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info(customers)');
      const hasContactsJson = columns.some(column => String(column.name).toLowerCase() === 'contacts_json');
      if (!hasContactsJson) {
        await prisma.$executeRawUnsafe('ALTER TABLE customers ADD COLUMN contacts_json TEXT');
      }
    })().catch((error) => {
      customerContactsColumnReady = null;
      throw error;
    });
  }

  await customerContactsColumnReady;
}

export async function loadCustomerAddressMap(customerIds: number[]) {
  if (customerIds.length === 0) {
    return new Map<number, { address: string | null; addressesJson: string | null }>();
  }

  const ids = customerIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0);
  if (ids.length === 0) {
    return new Map<number, { address: string | null; addressesJson: string | null }>();
  }

  const rows = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, address: true, addressesJson: true },
  });

  return new Map(rows.map(row => [
    Number(row.id),
    {
      address: row.address ?? null,
      addressesJson: row.addressesJson ?? null,
    },
  ]));
}

export async function persistCustomerAddresses(tx: Prisma.TransactionClient, customerId: number, addresses: CustomerAddressesInput) {
  await tx.$executeRawUnsafe(
    'UPDATE customers SET addresses_json = ? WHERE id = ?',
    serializeCustomerAddresses(addresses),
    customerId,
  );
}

export async function loadCustomerContactMap(customerIds: number[]) {
  if (customerIds.length === 0) {
    return new Map<number, { contactsJson: string | null }>();
  }

  const ids = customerIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0);
  if (ids.length === 0) {
    return new Map<number, { contactsJson: string | null }>();
  }

  await ensureCustomerContactsColumn();

  const rows = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, contactsJson: true },
  });

  return new Map(rows.map(row => [
    Number(row.id),
    {
      contactsJson: row.contactsJson ?? null,
    },
  ]));
}

export async function persistCustomerContacts(tx: Prisma.TransactionClient, customerId: number, contacts: unknown) {
  await ensureCustomerContactsColumn();
  await tx.$executeRawUnsafe(
    'UPDATE customers SET contacts_json = ? WHERE id = ?',
    serializeCustomerContacts(contacts),
    customerId,
  );
}

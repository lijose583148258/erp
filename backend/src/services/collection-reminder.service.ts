import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { getDueDate, getOutstandingAmount } from './collection/collection.helpers';

export interface ReminderPreview {
  orderId: number;
  orderNo: string;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  dueDate: Date;
  outstanding: number;
}

const getCustomerDisplayName = (customer: {
  name: string;
  nameZh?: string | null;
  nameEn?: string | null;
  nameVi?: string | null;
}) => customer.nameZh || customer.nameEn || customer.nameVi || customer.name;

export class CollectionReminderService {
  static async createReminder(req: AuthRequest, orderId: number): Promise<ReminderPreview | null> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        finalAmount: true,
        paidAmount: true,
        receivableAdjustmentAmount: true,
        paymentTerms: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            name: true,
            nameZh: true,
            nameEn: true,
            nameVi: true,
          },
        },
      },
    });

    if (!order) {
      return null;
    }

    const dueDate = getDueDate(order.createdAt, order.paymentTerms);
    const outstanding = getOutstandingAmount(
      Number(order.finalAmount),
      Number(order.paidAmount),
      Number(order.receivableAdjustmentAmount),
    );

    await prisma.auditLog.create({
      data: {
        userId: req.user!.userId,
        action: 'COLLECTION_REMINDER',
        resource: 'order',
        resourceId: order.id,
          details: JSON.stringify({
          orderNo: order.orderNo,
          customerId: order.customer.id,
          customerName: getCustomerDisplayName(order.customer),
          customerNameZh: order.customer.nameZh || null,
          customerNameEn: order.customer.nameEn || null,
          customerNameVi: order.customer.nameVi || null,
          customerDisplayName: getCustomerDisplayName(order.customer),
          dueDate,
          outstanding,
        }),
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      },
    });

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      customerName: getCustomerDisplayName(order.customer),
      customerNameZh: order.customer.nameZh || null,
      customerNameEn: order.customer.nameEn || null,
      customerNameVi: order.customer.nameVi || null,
      customerDisplayName: getCustomerDisplayName(order.customer),
      dueDate,
      outstanding,
    };
  }
}

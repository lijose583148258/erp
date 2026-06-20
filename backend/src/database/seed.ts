import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { demoAssetTypes, demoCustomers, demoUsers } from './seed-fixtures';

const ensureUser = async (username: string, role: string, password: string, segment?: string) => {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { username } });

  if (existing) {
    return prisma.user.update({
      where: { username },
      data: {
        role,
        segment: segment || existing.segment || null,
        email: `${username}@ailaoda.local`,
        isActive: true,
        passwordHash,
        mustChangePassword: true,
      },
    });
  }

  return prisma.user.create({
    data: {
      username,
      passwordHash,
      email: `${username}@ailaoda.local`,
      role,
      segment: segment || null,
      isActive: true,
      mustChangePassword: true,
    },
  });
};

const ensureCustomer = async (data: {
  name: string;
  licenseNumber: string;
  creditLimit: number;
  riskLevel: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  segment: string;
  salespersonId: number;
}) => {
  const existing = await prisma.customer.findFirst({
    where: { licenseNumber: data.licenseNumber },
  });

  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...data,
        status: 'active',
        overdueAmount: existing.overdueAmount || 0,
      },
    });
  }

  return prisma.customer.create({
    data: {
      ...data,
      status: 'active',
      overdueAmount: 0,
    },
  });
};

const ensureDemoOrder = async (customerId: number, salesId: number) => {
  const orderNo = 'ORD-SEED-DEMO-001';
  const existing = await prisma.order.findUnique({ where: { orderNo } });

  if (existing) {
    return existing;
  }

  return prisma.order.create({
    data: {
      orderNo,
      customerId,
      totalAmount: 50000,
      discountAmount: 0,
      finalAmount: 50000,
      paymentTerms: 30,
      status: 'pending',
      createdBy: salesId,
      items: {
        create: [
          {
            productName: '工业乙醚',
            specification: '99.5%',
            quantity: 1000,
            unit: 'kg',
            unitPrice: 50,
            totalPrice: 50000,
          },
        ],
      },
    },
  });
};

const ensureAssetSeed = async (customerId: number, createdBy: number) => {
  for (const assetType of demoAssetTypes) {
    const existingBalance = await prisma.assetBalance.findFirst({
      where: { customerId, assetType },
    });

    if (!existingBalance) {
      const qty = Math.floor(Math.random() * 20) + 5;

      await prisma.assetBalance.create({
        data: {
          customerId,
          assetType,
          balance: qty,
        },
      });

      await prisma.assetTransaction.create({
        data: {
          customerId,
          assetType,
          quantity: qty,
          action: 'outbound',
          note: '初始数据录入',
          createdBy,
        },
      });
    }
  }
};

async function seed() {
  // C5修复：生产环境禁止执行 seed（防止弱密码账号被创建）
  if (process.env.NODE_ENV === 'production') {
    logger.error('安全拒绝: 不允许在生产环境执行 seed 操作');
    process.exit(1);
  }

  logger.info('开始初始化种子数据...');

  try {
    const seededUsers = [];
    for (const user of demoUsers) {
      seededUsers.push(await ensureUser(user.username, user.role, user.password, user.segment));
      logger.info(`用户就绪: ${user.username}`);
    }

    const admin = seededUsers.find(item => item.username === 'admin');
    const sales = seededUsers.find(item => item.username === 'sales');
    const manager = seededUsers.find(item => item.username === 'manager');

    if (!admin || !sales || !manager) {
      throw new Error('默认种子用户创建失败');
    }

    const customerRecords = [
      {
        ...demoCustomers[0],
        salespersonId: sales.id,
      },
      {
        ...demoCustomers[1],
        salespersonId: sales.id,
      },
      {
        name: '广州材料科技',
        licenseNumber: 'GZ-2024-003',
        creditLimit: 200000,
        riskLevel: 'low',
        contactName: '王专员',
        contactPhone: '13800138003',
        contactEmail: 'wang@gztech.com',
        segment: 'direct',
        salespersonId: manager.id,
      },
    ];

    const seededCustomers = [];
    for (const customer of customerRecords) {
      seededCustomers.push(await ensureCustomer(customer));
    }
    logger.info(`客户就绪: ${seededCustomers.length} 条`);

    const primaryCustomer = seededCustomers[0];
    const demoOrder = await ensureDemoOrder(primaryCustomer.id, sales.id);
    logger.info(`订单就绪: ${demoOrder.orderNo}`);

    await ensureAssetSeed(primaryCustomer.id, admin.id);
    logger.info('资产记录就绪');

    logger.info('种子数据初始化完成');
    logger.info('默认账户: admin / admin123, manager / manager123, sales / sales123');
  } catch (error) {
    logger.error('种子数据初始化失败', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});

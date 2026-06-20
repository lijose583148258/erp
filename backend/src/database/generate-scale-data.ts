import prisma from '../config/database';
import { logger } from '../utils/logger';

async function generateScaleData() {
    const TOTAL_CUSTOMERS = 165000;
    const BATCH_SIZE = 5000;

    logger.info(`🚀 开始生成海量数据: ${TOTAL_CUSTOMERS} 条客户记录...`);
    const startTime = Date.now();

    // 先获取一个有效的销售人员 ID
    const salesUser = await prisma.user.findFirst({
        where: { role: 'sales' }
    });

    if (!salesUser) {
        logger.error('❌ 未找到销售角色用户，请先运行 seed 脚本');
        return;
    }

    let createdCount = 0;

    for (let i = 0; i < TOTAL_CUSTOMERS; i += BATCH_SIZE) {
        const batch = [];
        const currentBatchSize = Math.min(BATCH_SIZE, TOTAL_CUSTOMERS - i);

        for (let j = 0; j < currentBatchSize; j++) {
            const index = i + j;
            batch.push({
                name: `客户_${index.toString().padStart(6, '0')}`,
                licenseNumber: `LIC-${index.toString().padStart(8, '0')}`,
                creditLimit: Math.floor(Math.random() * 1000000),
                overdueAmount: Math.random() > 0.9 ? Math.floor(Math.random() * 50000) : 0,
                riskLevel: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
                salespersonId: salesUser.id,
                segment: Math.random() > 0.5 ? 'direct' : 'channel',
                status: 'active',
                contactName: `联系人_${index}`,
                contactPhone: `138${index.toString().padStart(8, '0').slice(-8)}`,
                address: `某省某市某街道 ${index} 号`,
            });
        }

        await prisma.customer.createMany({
            data: batch
        });

        createdCount += currentBatchSize;
        const percent = ((createdCount / TOTAL_CUSTOMERS) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(`⏳ 进度: ${percent}% (${createdCount}/${TOTAL_CUSTOMERS}) - 已耗时: ${elapsed}s`);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`✅ 成功构造 16.5w+ 数据！总耗时: ${totalTime}s`);

    // 断开数据库连接
    await prisma.$disconnect();
}

generateScaleData().catch(err => {
    logger.error('❌ 数据构造失败:', err);
    process.exit(1);
});

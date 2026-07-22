import prisma from '../config/database';
import {
  orderImportRetentionService,
  resolveOrderImportRetentionPolicy,
} from '../services/order-import-retention.service';

async function main() {
  try {
    const report = await orderImportRetentionService.run(resolveOrderImportRetentionPolicy());
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();

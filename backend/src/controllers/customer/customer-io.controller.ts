import { Response } from 'express';
import prisma from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { logger } from '../../utils/logger';
import { withDbRetry } from '../../utils/dbRetry';
import { buildCustomerExportWorkbook, buildCustomerImportData } from '../../services/customer-io.service';
import type { CustomerImportData } from '../../services/customer-io.service';
import { buildCustomerExportWhere, canImportCustomer, validateAssignedSalesperson } from './customer.access';
import { asRequestBody } from './customer-request.helpers';
import { persistCustomerAddresses, persistCustomerContacts, writeCustomerAuditLog } from './customer.persistence';
import type { CustomerSegment } from './customer.types';

export async function importCustomers(req: AuthRequest, res: Response) {
  try {
    if (!canImportCustomer(req)) {
      return res.status(403).json({
        success: false,
        message: '当前角色不能导入客户',
      } as ApiResponse);
    }

    const importBody = asRequestBody(req.body);
    const payload = Array.isArray(req.body)
      ? req.body
      : Array.isArray(importBody.customers)
        ? importBody.customers
        : [];
    const { result, validCustomers } = await buildCustomerImportData(req, payload);
    result.success = 0;
    result.imported = 0;

    if (validCustomers.length > 0) {
      for (const customer of validCustomers as CustomerImportData[]) {
        const { addresses, contacts, salespersonId, __row, ...rest } = customer;
        if (salespersonId) {
          const salespersonCheck = await validateAssignedSalesperson(Number(salespersonId), (rest.segment as CustomerSegment) || 'mixed');
          if (!salespersonCheck.ok) {
            result.failed += 1;
            result.errors.push({
              row: __row || result.success + result.failed,
              message: salespersonCheck.message,
            });
            continue;
          }
        }
        try {
          await withDbRetry(() => prisma.$transaction(async (tx) => {
            const created = await tx.customer.create({
              data: {
                ...rest,
                poolUpdatedAt: new Date(),
                poolUpdatedByUser: { connect: { id: req.user!.userId } },
                ...(salespersonId ? { salesperson: { connect: { id: salespersonId } } } : {}),
              },
            });

            await persistCustomerAddresses(tx, created.id, addresses);
            await persistCustomerContacts(tx, created.id, contacts || []);
          }), { label: 'importCustomer' });
          result.success += 1;
          result.imported = result.success;
        } catch (error) {
          result.failed += 1;
          result.errors.push({
            row: __row || result.success + result.failed,
            message: error instanceof Error ? error.message : '客户导入失败',
          });
        }
      }
    }

    await writeCustomerAuditLog({
      userId: req.user!.userId,
      action: 'IMPORT',
      details: `批量导入客户: success ${result.success}, failed ${result.failed}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.json({
      success: true,
      data: {
        ...result,
        imported: result.imported || result.success,
      },
      message: '客户导入完成',
    } as ApiResponse);
  } catch (error) {
    logger.error('导入客户错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
    } as ApiResponse);
  }
}

export async function exportCustomers(req: AuthRequest, res: Response) {
  try {
    const { workbook, customers } = await buildCustomerExportWorkbook(req, {
      status: req.query.status,
      riskLevel: req.query.riskLevel,
    }, buildCustomerExportWhere(req));

    const fileName = `customers_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await writeCustomerAuditLog({
      userId: req.user!.userId,
      action: 'EXPORT',
      details: `导出客户: ${customers.length}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error('导出客户错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
    } as ApiResponse);
  }
}

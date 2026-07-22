import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { writeOrderAuditLog } from '../services/order-audit.service';
import { normalizeOrderImportIdempotencyKey } from '../services/order-import-idempotency.service';
import { orderImportService } from '../services/order-import.service';
import { OrderWorkspaceService } from '../services/order-workspace.service';
import { ApiResponse } from '../types/api.types';
import { logger } from '../utils/logger';

export async function importOrders(req: AuthRequest, res: Response) {
    try {
        const { orders } = req.body;
        const idempotencyKey = normalizeOrderImportIdempotencyKey(req.get('idempotency-key'));
        if (!idempotencyKey) {
            return res.status(400).json({
                success: false,
                message: 'A valid Idempotency-Key header (8-80 characters) is required.',
            } as ApiResponse);
        }
        const result = await orderImportService.importOrders(orders, req, idempotencyKey);

        if ('error' in result) {
            return res.status(result.statusCode || 400).json({
                success: false,
                message: result.error,
            } as ApiResponse);
        }

        return res.json({
            success: true,
            data: result.result,
            message: `${result.replayed ? '幂等重放：' : '导入完成：'}成功 ${result.result.success} 条，失败 ${result.result.failed} 条`,
        } as ApiResponse);
    } catch (error) {
        logger.error('Failed to import orders:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
        } as ApiResponse);
    }
}

export async function exportOrders(req: AuthRequest, res: Response) {
    try {
        const { workbook, orders } = await OrderWorkspaceService.exportOrders(
            {
                status: req.query.status as string | undefined,
                startDate: req.query.startDate as string | undefined,
                endDate: req.query.endDate as string | undefined,
                lang: req.query.lang as string | undefined,
            },
            req,
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=orders_${new Date().toISOString().split('T')[0]}.xlsx`);

        await writeOrderAuditLog(req, {
            action: 'EXPORT',
            details: `导出订单: ${orders.length} 条`,
        });

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        logger.error('Failed to export orders:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
        } as ApiResponse);
    }
}

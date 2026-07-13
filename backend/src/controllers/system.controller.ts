import { Request, Response } from 'express';
import { BackupService, getBackupOperationConflictMessage } from '../services/backup.service';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { runtime } from '../config/runtime';
import { SearchIndexService } from '../services/search-index.service';

async function writeSystemAuditLog(req: Request, input: {
    action: string;
    details: string;
    resource?: string;
}) {
    const userId = (req as any).user?.userId;
    if (!userId) return;
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action: input.action,
                resource: input.resource || 'database',
                details: input.details,
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
            }
        });
    } catch (error) {
        logger.warn('系统备份/恢复审计日志写入失败，业务操作已保留', error);
    }
}

export class SystemController {
    /**
     * Get system deployment status
     */
    async getStatus(req: Request, res: Response) {
        try {
            const database = BackupService.getDatabaseStatus();

            res.json({
                success: true,
                data: {
                    nodeEnv: runtime.nodeEnv,
                    port: runtime.port,
                    serveFrontend: runtime.serveFrontend,
                    trustProxy: runtime.trustProxy,
                    frontendDistDir: runtime.frontendDistDir,
                    database,
                }
            });
        } catch (error) {
            logger.error('Failed to get system status', error);
            res.status(500).json({ success: false, message: 'Failed to get system status' });
        }
    }

    async getSearchStatus(_req: Request, res: Response) {
        res.json({ success: true, data: SearchIndexService.getStatus() });
    }

    async reindexSearch(req: Request, res: Response) {
        try {
            const result = await SearchIndexService.reindexAll();
            await writeSystemAuditLog(req, {
                action: 'SYSTEM_SEARCH_REINDEX',
                resource: 'search',
                details: `Rebuilt external search indexes: customers=${result.indexes.customers.documents}, orders=${result.indexes.orders.documents}`,
            });
            res.json({ success: true, data: result, message: 'Search indexes rebuilt successfully' });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Search reindex failed';
            logger.error('Search reindex controller error', error);
            res.status(message === 'SEARCH_REINDEX_IN_PROGRESS' ? 409 : 503).json({ success: false, message });
        }
    }

    /**
     * Trigger database backup
     */
    async createBackup(req: Request, res: Response) {
        try {
            const fileName = await BackupService.performBackup();

            await writeSystemAuditLog(req, {
                action: 'SYSTEM_BACKUP',
                details: `Manual backup executed: ${fileName}`,
            });

            res.status(201).json({
                success: true,
                message: 'Database backup created successfully',
                data: { fileName }
            });
        } catch (error) {
            logger.error('Create backup controller error', error);
            const conflictMessage = getBackupOperationConflictMessage(error);
            res.status(conflictMessage ? 409 : 500).json({
                success: false,
                message: conflictMessage || 'Backup failed, please check server logs',
            });
        }
    }

    /**
     * 获取备份历史列表
     */
    async getBackups(req: Request, res: Response) {
        try {
            const backups = BackupService.getBackupList();
            res.json({
                success: true,
                data: backups
            });
        } catch (error) {
            logger.error('Get backup list controller error', error);
            res.status(500).json({ success: false, message: 'Failed to get backup list' });
        }
    }

    /**
     * 从指定备份文件恢复数据库
     * 仅限 admin 角色调用，恢复前会自动创建恢复前快照。
     */
    async restoreBackup(req: Request, res: Response) {
        try {
            const { fileName } = req.body;

            if (!fileName || typeof fileName !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: '缺少 fileName 参数或格式无效',
                });
            }

            const restoreResult = await BackupService.restoreBackup(fileName);

            await writeSystemAuditLog(req, {
                action: 'SYSTEM_RESTORE',
                details: `Database restored from backup: ${restoreResult.fileName}`,
            });

            res.json({
                success: true,
                message: `数据库已从备份 ${restoreResult.fileName} 恢复成功`,
                data: restoreResult,
            });
        } catch (error) {
            logger.error('Restore backup controller error', error);
            const conflictMessage = getBackupOperationConflictMessage(error);
            const message = conflictMessage || (error instanceof Error ? error.message : 'Restore failed');
            res.status(conflictMessage ? 409 : 500).json({ success: false, message });
        }
    }
}

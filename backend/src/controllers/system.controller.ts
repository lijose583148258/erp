import { Request, Response } from 'express';
import { BackupService } from '../services/backup.service';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { runtime } from '../config/runtime';

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

    /**
     * Trigger database backup
     */
    async createBackup(req: Request, res: Response) {
        try {
            const fileName = await BackupService.performBackup();

            await prisma.auditLog.create({
                data: {
                    userId: (req as any).user.userId,
                    action: 'SYSTEM_BACKUP',
                    resource: 'database',
                    details: `Manual backup executed: ${fileName}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                }
            });

            res.status(201).json({
                success: true,
                message: 'Database backup created successfully',
                data: { fileName }
            });
        } catch (error) {
            logger.error('Create backup controller error', error);
            res.status(500).json({ success: false, message: 'Backup failed, please check server logs' });
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

            const restoredName = await BackupService.restoreBackup(fileName);

            await prisma.auditLog.create({
                data: {
                    userId: (req as any).user.userId,
                    action: 'SYSTEM_RESTORE',
                    resource: 'database',
                    details: `Database restored from backup: ${restoredName}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                }
            });

            res.json({
                success: true,
                message: `数据库已从备份 ${restoredName} 恢复成功`,
                data: { fileName: restoredName },
            });
        } catch (error) {
            logger.error('Restore backup controller error', error);
            const message = error instanceof Error ? error.message : 'Restore failed';
            res.status(500).json({ success: false, message });
        }
    }
}

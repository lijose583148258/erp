import { Router } from 'express';
import { SystemController } from '../controllers/system.controller';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = Router();
const controller = new SystemController();

// Base path: /api/system

router.get(
    '/status',
    authenticate,
    authorizePermission('system.read'),
    (req, res) => controller.getStatus(req, res)
);

router.get(
    '/backups',
    authenticate,
    authorizePermission('system.read'),
    (req, res) => controller.getBackups(req, res)
);

router.get(
    '/search/status',
    authenticate,
    authorizePermission('system.read'),
    (req, res) => controller.getSearchStatus(req, res)
);

router.post(
    '/search/reindex',
    authenticate,
    authorizePermission('system.backup.manage'),
    (req, res) => controller.reindexSearch(req, res)
);

router.post(
    '/backups',
    authenticate,
    authorizePermission('system.backup.manage'),
    (req, res) => controller.createBackup(req, res)
);

// 从备份文件恢复数据库（仅 admin）
router.post(
    '/restore',
    authenticate,
    authorizePermission('system.backup.manage'),
    (req, res) => controller.restoreBackup(req, res)
);

export default router;

import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { FinanceController } from '../controllers/finance.controller';

const router = Router();
const controller = new FinanceController();

router.use(authenticate, authorizePermission('finance.read'));

router.get('/summary', (req, res) => controller.getSummary(req, res));
router.get('/workspace', (req, res) => controller.getWorkspace(req, res));

export default router;

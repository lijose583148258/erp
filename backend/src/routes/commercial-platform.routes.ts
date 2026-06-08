import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { CommercialPlatformController } from '../controllers/commercial-platform.controller';

const router = Router();
const controller = new CommercialPlatformController();

router.use(authenticate);

router.get('/workflow/definitions', authorizePermission('commercial.read'), authRoute(controller.listWorkflowDefinitions.bind(controller)));
router.post(
  '/workflow/definitions',
  authorizePermission('commercial.workflow.manage'),
  [
    body('code').isString().matches(/^[a-z][a-z0-9_-]{1,63}$/),
    body('name').isString().isLength({ min: 2, max: 100 }),
    body('documentType').isString().isLength({ min: 2, max: 60 }),
    body('config').optional().isObject(),
  ],
  validateRequest,
  authRoute(controller.createWorkflowDefinition.bind(controller)),
);

router.post(
  '/workflow/instances',
  authorizePermission('commercial.workflow.manage'),
  [
    body('definitionCode').isString().isLength({ min: 2, max: 64 }),
    body('documentType').isString().isLength({ min: 2, max: 60 }),
    body('documentId').isString().isLength({ min: 1, max: 100 }),
  ],
  validateRequest,
  authRoute(controller.createWorkflowInstance.bind(controller)),
);

router.get('/workflow/tasks', authorizePermission('commercial.read'), authRoute(controller.listWorkflowTasks.bind(controller)));
router.post(
  '/workflow/tasks/:id/actions',
  authorizePermission('commercial.workflow.manage'),
  [
    param('id').isInt({ min: 1 }),
    body('action').isIn(['approve', 'reject']),
    body('comment').optional().isString().isLength({ max: 500 }),
  ],
  validateRequest,
  authRoute(controller.actOnWorkflowTask.bind(controller)),
);

router.get('/notifications', authorizePermission('commercial.read'), authRoute(controller.listNotifications.bind(controller)));
router.post(
  '/notifications',
  authorizePermission('commercial.notification.write'),
  [
    body('title').isString().isLength({ min: 1, max: 120 }),
    body('message').isString().isLength({ min: 1, max: 1000 }),
    body('userId').optional().isInt({ min: 1 }),
    body('role').optional().isString().isLength({ min: 2, max: 50 }),
    body('type').optional().isString().isLength({ min: 1, max: 50 }),
    body('severity').optional().isIn(['info', 'warning', 'danger', 'success']),
  ],
  validateRequest,
  authRoute(controller.createNotification.bind(controller)),
);
router.put('/notifications/:id/read', authorizePermission('commercial.read'), [param('id').isInt({ min: 1 })], validateRequest, authRoute(controller.markNotificationRead.bind(controller)));

router.get('/readiness', authorizePermission('commercial.read'), authRoute(controller.getPlatformReadiness.bind(controller)));
router.get('/bi/summary', authorizePermission('commercial.read'), authRoute(controller.getBiSummary.bind(controller)));
router.post('/alerts/run', authorizePermission('commercial.alert.run'), authRoute(controller.runAlertRules.bind(controller)));

export default router;

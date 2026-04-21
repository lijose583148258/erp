import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import {
  createRole,
  listPermissions,
  listRoles,
  updateRole,
} from '../services/authorization-policy.service';
import { ALL_PERMISSION_CODES } from '../permissions/permissionRegistry';

const router = Router();

const roleCodeValidator = body('code')
  .optional()
  .isString()
  .matches(/^[a-z][a-z0-9_:-]{1,49}$/);

const rolePayloadValidators = [
  roleCodeValidator,
  body('name').isString().trim().isLength({ min: 2, max: 80 }),
  body('description').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('isActive').optional().isBoolean(),
  body('dataScopes').optional().isArray(),
  body('dataScopes.*').optional().isString().isLength({ min: 1, max: 80 }),
  body('permissions').isArray({ min: 1 }),
  body('permissions.*').isIn(ALL_PERMISSION_CODES),
];

router.use(authenticate);
router.use(authorizePermission('team.write'));

router.get('/', async (_req, res) => {
  const roles = await listRoles();
  res.json({ success: true, data: roles });
});

router.get('/permissions', async (_req, res) => {
  const permissions = await listPermissions();
  res.json({ success: true, data: permissions });
});

router.post(
  '/',
  rolePayloadValidators,
  validateRequest,
  authRoute(async (req, res) => {
    try {
      const role = await createRole(req.body, req.user?.userId);
      res.status(201).json({ success: true, data: role, message: '角色创建成功' });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : '角色创建失败',
      });
    }
  }),
);

router.put(
  '/:code',
  [
    param('code').matches(/^[a-z][a-z0-9_:-]{1,49}$/),
    ...rolePayloadValidators.filter((validator) => validator !== roleCodeValidator),
  ],
  validateRequest,
  authRoute(async (req, res) => {
    try {
      const role = await updateRole(req.params.code, req.body);
      res.json({ success: true, data: role, message: '角色更新成功' });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : '角色更新失败',
      });
    }
  }),
);

export default router;

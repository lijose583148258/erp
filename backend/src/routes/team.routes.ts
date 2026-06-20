import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { body, param } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest';
import { TeamController } from '../controllers/team.controller';

const router = Router();
const controller = new TeamController();

router.use(authenticate);

/**
 * @route GET /api/team
 * @desc 获取团队成员列表
 */
router.get('/', authorizePermission('team.read'), controller.getTeamMembers);

router.post(
    '/',
    authorizePermission('team.write'),
    [
        body('username').trim().notEmpty().isLength({ min: 2, max: 50 }),
        body('password').notEmpty().isLength({ min: 6, max: 100 }),
        body('email').optional().isEmail(),
        body('role').optional().isString().matches(/^[a-z][a-z0-9_:-]{1,49}$/),
        body('segment').optional().isIn(['direct', 'channel', 'mixed']),
    ],
    validateRequest,
    controller.createMember
);

/**
 * @route GET /api/team/performance
 * @desc 获取团队业绩
 */
router.get('/performance', authorizePermission('team.read'), controller.getPerformance);

/**
 * @route PUT /api/team/:id
 * @desc 更新团队成员信息
 */
router.put(
    '/:id',
    authorizePermission('team.write'),
    [
        param('id').isInt({ min: 1 }),
        body('role').optional().isString().matches(/^[a-z][a-z0-9_:-]{1,49}$/),
        body('segment').optional().isIn(['direct', 'channel', 'mixed']),
        body('isActive').optional().isBoolean(),
    ],
    validateRequest,
    controller.updateMember
);

export default router;

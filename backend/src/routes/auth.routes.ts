import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate, authorizePermission } from '../middleware/auth';
import { body } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest';
import { validateZod } from '../middleware/validateZod';
import { refreshTokenSchema } from '../validators';

const router = Router();
const authController = new AuthController();

const loginValidation = [
    body('username')
        .trim()
        .notEmpty()
        .withMessage('用户名不能为空')
        .isLength({ min: 2, max: 50 })
        .withMessage('用户名长度应为 2-50 个字符'),
    body('password')
        .notEmpty()
        .withMessage('密码不能为空')
        .isLength({ min: 6, max: 100 })
        .withMessage('密码长度应为 6-100 个字符'),
];

const registerValidation = [
    body('username')
        .trim()
        .notEmpty()
        .withMessage('用户名不能为空')
        .isLength({ min: 2, max: 50 })
        .withMessage('用户名长度应为 2-50 个字符')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('用户名只能包含字母、数字和下划线'),
    body('password')
        .notEmpty()
        .withMessage('密码不能为空')
        .isLength({ min: 6, max: 100 })
        .withMessage('密码长度应为 6-100 个字符'),
    body('email')
        .optional()
        .isEmail()
        .withMessage('邮箱格式不正确'),
    body('role')
        .optional()
        .isString()
        .matches(/^[a-z][a-z0-9_:-]{1,49}$/)
        .withMessage('角色类型无效'),
    body('segment')
        .optional()
        .isIn(['direct', 'channel', 'mixed'])
        .withMessage('业务线类型无效'),
];

router.post('/login', loginValidation, validateRequest, authController.login);
router.post('/register', authenticate, authorizePermission('team.write'), registerValidation, validateRequest, authController.register);
router.post('/refresh', validateZod(refreshTokenSchema), authController.refreshToken);
router.get('/me', authenticate, authController.getCurrentUser);
router.post('/logout', authenticate, authController.logout);

router.put(
    '/password',
    authenticate,
    [
        body('oldPassword').notEmpty().withMessage('请输入原密码'),
        body('newPassword')
            .notEmpty()
            .isLength({ min: 6, max: 100 })
            .withMessage('新密码长度应为 6-100 个字符'),
    ],
    validateRequest,
    authController.changePassword
);

export default router;

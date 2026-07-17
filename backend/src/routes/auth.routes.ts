import { createHash } from 'node:crypto';
import { Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/auth.controller';
import { authenticate, authorizePermission } from '../middleware/auth';
import { body } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest';
import { validateZod } from '../middleware/validateZod';
import { refreshTokenSchema } from '../validators';
import { createLoginRateLimitStore } from '../services/distributed-rate-limit.service';

const router = Router();
const authController = new AuthController();

const loginRateLimitMessage = {
    success: false,
    message: 'Too many login attempts. Please try again later.',
    errorCode: 'LOGIN_RATE_LIMITED',
};

const loginIpLimiter = rateLimit({
    windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.LOGIN_IP_RATE_LIMIT_MAX || 100),
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    store: createLoginRateLimitStore('ip'),
    message: loginRateLimitMessage,
});

const loginAccountKey = (request: Request) => {
    const rawUsername = typeof request.body?.username === 'string' ? request.body.username : 'anonymous';
    const normalizedUsername = rawUsername.normalize('NFKC').trim().toLowerCase() || 'anonymous';
    const usernameHash = createHash('sha256').update(normalizedUsername).digest('hex').slice(0, 32);
    const address = request.ip || request.socket.remoteAddress || 'unknown';
    return `${address}:${usernameHash}`;
};

const loginAccountLimiter = rateLimit({
    windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 8),
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    keyGenerator: loginAccountKey,
    store: createLoginRateLimitStore('account'),
    message: loginRateLimitMessage,
});

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

router.post('/login', loginIpLimiter, loginAccountLimiter, loginValidation, validateRequest, authController.login);
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

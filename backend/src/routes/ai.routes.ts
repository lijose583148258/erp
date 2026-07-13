import { Router } from 'express';
import { AIController } from '../controllers/ai.controller';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { aiAssistSchema } from '../validators/ai';
import rateLimit from 'express-rate-limit';
import { createAIRateLimitStore } from '../services/distributed-rate-limit.service';
import { recordAIMetric } from '../middleware/metricsMiddleware';

const router = Router();
const controller = new AIController();
const aiLimiter = rateLimit({
  windowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.AI_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  store: createAIRateLimitStore(),
  keyGenerator: req => String((req as any).user.userId),
  handler: (_req, res) => {
    recordAIMetric('rate_limited');
    res.status(429).json({ success: false, message: 'AI request rate limit exceeded.', errorCode: 'AI_RATE_LIMITED' });
  },
});

router.use(authenticate);
router.get('/status', authorizePermission('ai.assistant.use'), authRoute((req, res) => controller.status(req, res)));
router.post('/assist', aiLimiter, authorizePermission('ai.assistant.use'), validateZod(aiAssistSchema), authRoute((req, res) => controller.assist(req, res)));

export default router;

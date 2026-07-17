import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AIGovernanceService } from '../services/ai-governance.service';
import { AIAssistInput } from '../validators/ai';
import { logger } from '../utils/logger';

const audit = async (req: AuthRequest, action: string, details: string) => {
  if (!req.user) return;
  try {
    await prisma.auditLog.create({ data: {
      userId: req.user.userId,
      action,
      resource: 'ai-assistant',
      details,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    } });
  } catch (error) {
    logger.warn('AI audit write failed; response was preserved', error);
  }
};

export class AIController {
  status(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: AIGovernanceService.getStatus() });
  }

  async assist(req: AuthRequest, res: Response) {
    const result = await AIGovernanceService.assist(req.body as AIAssistInput, {
      role: req.user?.role || 'unknown',
      segment: req.user?.segment,
    });
    await audit(req, result.mode === 'external' ? 'AI_ASSIST_EXTERNAL' : 'AI_ASSIST_FALLBACK', `mode=${result.mode}; reason=${result.reason || 'none'}`);
    res.json({ success: true, data: result });
  }
}

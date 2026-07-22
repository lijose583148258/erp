import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AIGovernanceService } from '../services/ai-governance.service';
import { AIAssistInput } from '../validators/ai';
import { logger } from '../utils/logger';

const audit = async (req: AuthRequest, action: string, details: string, required = false) => {
  if (!req.user) {
    if (required) throw new Error('AI_AUDIT_IDENTITY_UNAVAILABLE');
    return;
  }
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
    logger.warn(required
      ? 'AI mandatory audit write failed; external dispatch was blocked'
      : 'AI audit write failed; local response was preserved', error);
    if (required) throw new Error('AI_AUDIT_UNAVAILABLE');
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
    }, {
      beforeExternalDispatch: metadata => audit(
        req,
        'AI_ASSIST_EXTERNAL_DISPATCH',
        JSON.stringify(metadata),
        true,
      ),
    });
    await audit(req, result.mode === 'external' ? 'AI_ASSIST_EXTERNAL' : 'AI_ASSIST_FALLBACK', `mode=${result.mode}; reason=${result.reason || 'none'}`);
    res.json({ success: true, data: result });
  }
}

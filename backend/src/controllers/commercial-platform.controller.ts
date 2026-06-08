import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { commercialPlatformService } from '../services/commercial-platform.service';

const requireUser = (req: AuthRequest) => {
  if (!req.user) throw new Error('Unauthenticated');
  return req.user;
};

export class CommercialPlatformController {
  async listWorkflowDefinitions(_req: AuthRequest, res: Response) {
    const data = await commercialPlatformService.listWorkflowDefinitions();
    res.json({ success: true, data });
  }

  async createWorkflowDefinition(req: AuthRequest, res: Response) {
    const user = requireUser(req);
    const { code, name, documentType, config } = req.body;
    const data = await commercialPlatformService.createWorkflowDefinition({
      code,
      name,
      documentType,
      config,
      createdBy: user.userId,
    });
    res.status(201).json({ success: true, data });
  }

  async createWorkflowInstance(req: AuthRequest, res: Response) {
    const user = requireUser(req);
    const { definitionCode, documentType, documentId } = req.body;
    const data = await commercialPlatformService.createWorkflowInstance({
      definitionCode,
      documentType,
      documentId,
      requesterId: user.userId,
    });
    res.status(201).json({ success: true, data });
  }

  async listWorkflowTasks(req: AuthRequest, res: Response) {
    const user = requireUser(req);
    const data = await commercialPlatformService.listWorkflowTasks(user);
    res.json({ success: true, data });
  }

  async actOnWorkflowTask(req: AuthRequest, res: Response) {
    const user = requireUser(req);
    const data = await commercialPlatformService.actOnWorkflowTask({
      taskId: Number(req.params.id),
      action: req.body.action,
      actorId: user.userId,
      comment: req.body.comment,
    });
    res.json({ success: true, data });
  }

  async listNotifications(req: AuthRequest, res: Response) {
    const user = requireUser(req);
    const data = await commercialPlatformService.listNotifications(user);
    res.json({ success: true, data });
  }

  async createNotification(req: AuthRequest, res: Response) {
    const data = await commercialPlatformService.createNotification(req.body);
    res.status(201).json({ success: true, data });
  }

  async markNotificationRead(req: AuthRequest, res: Response) {
    const user = requireUser(req);
    await commercialPlatformService.markNotificationRead(Number(req.params.id), user);
    res.json({ success: true });
  }

  async getPlatformReadiness(_req: AuthRequest, res: Response) {
    const data = await commercialPlatformService.getPlatformReadiness();
    res.json({ success: true, data });
  }

  async getBiSummary(_req: AuthRequest, res: Response) {
    const data = await commercialPlatformService.getBiSummary();
    res.json({ success: true, data });
  }

  async runAlertRules(req: AuthRequest, res: Response) {
    const user = requireUser(req);
    const data = await commercialPlatformService.runAlertRules(user.userId);
    res.json({ success: true, data });
  }
}

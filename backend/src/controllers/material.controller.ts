import { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth';
import { MaterialMasterService } from '../services/material-master.service';
import { logger } from '../utils/logger';

const auditContext = (req: AuthRequest) => ({
  userId: req.user!.userId,
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
});

const errorStatus = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'MATERIAL_NOT_FOUND') return 404;
  if (message === 'MATERIAL_CONCURRENT_UPDATE') return 409;
  if (
    message === 'MATERIAL_RETIRED'
    || message === 'MATERIAL_ACTIVE_TEMPORARY'
    || message.startsWith('MATERIAL_STATUS_TRANSITION:')
  ) return 409;
  if ((error as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') return 409;
  return 500;
};

export class MaterialController {
  async list(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialMasterService.list(req.query as never);
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Material list failed', error);
      return res.status(500).json({ success: false, message: '物料主数据查询失败' });
    }
  }

  async getById(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialMasterService.getById(Number(req.params.id));
      if (!data) return res.status(404).json({ success: false, message: '物料不存在' });
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Material read failed', error);
      return res.status(500).json({ success: false, message: '物料主数据读取失败' });
    }
  }

  async create(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialMasterService.create(req.body, auditContext(req));
      return res.status(201).json({ success: true, data });
    } catch (error) {
      logger.error('Material create failed', error);
      const status = errorStatus(error);
      return res.status(status).json({
        success: false,
        message: status === 409 ? '物料编码或别名已存在，请选择现有物料或更换唯一编码' : '物料主数据创建失败',
      });
    }
  }

  async update(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialMasterService.update(Number(req.params.id), req.body, auditContext(req));
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Material update failed', error);
      const status = errorStatus(error);
      const message = error instanceof Error ? error.message : '';
      return res.status(status).json({
        success: false,
        message: message === 'MATERIAL_NOT_FOUND'
          ? '物料不存在'
          : message === 'MATERIAL_CONCURRENT_UPDATE'
            ? '物料已被其他用户修改，请刷新后重新提交'
            : status === 409
              ? '物料状态不允许当前修改'
              : '物料主数据更新失败',
      });
    }
  }

  async addAlias(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialMasterService.addAlias(Number(req.params.id), req.body, auditContext(req));
      return res.status(201).json({ success: true, data });
    } catch (error) {
      logger.error('Material alias create failed', error);
      const status = errorStatus(error);
      return res.status(status).json({
        success: false,
        message: status === 404
          ? '物料不存在'
          : status === 409
            ? '该别名已归属其他物料，不能重复建立'
            : '物料别名创建失败',
      });
    }
  }
}

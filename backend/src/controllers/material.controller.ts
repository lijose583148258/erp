import { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth';
import { MaterialGovernanceService } from '../services/material-governance.service';
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

const governanceError = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, { status: number; message: string }> = {
    MATERIAL_BACKFILL_DUPLICATE_SOURCE: { status: 400, message: '同一历史物料来源不能在一次回填中重复提交' },
    MATERIAL_BACKFILL_TARGET_NOT_FOUND: { status: 404, message: '目标物料不存在，请刷新后重新选择' },
    MATERIAL_BACKFILL_TARGET_NOT_ACTIVE: { status: 409, message: '只能关联已启用且非临时的正式物料' },
    MATERIAL_BACKFILL_UNIT_MISMATCH: { status: 409, message: '历史单位与目标物料基础单位不一致，不能直接回填' },
    MATERIAL_BACKFILL_SOURCE_CHANGED: { status: 409, message: '预览后历史数据已发生变化，请刷新预览后再提交' },
    MATERIAL_BACKFILL_LIMIT_EXCEEDED: { status: 413, message: '本次变更超过 500 条，请拆分后执行' },
    MATERIAL_BACKFILL_EMPTY: { status: 400, message: '没有可回填的历史明细' },
    MATERIAL_BACKFILL_CONCURRENT_UPDATE: { status: 409, message: '回填过程中数据被其他用户修改，本次操作已整体回滚' },
    MATERIAL_BACKFILL_IDEMPOTENCY_STATE_DRIFT: { status: 409, message: '同一回填请求的已执行批次与当前数据不一致，请先检查审计记录' },
    MATERIAL_GOVERNANCE_RUN_NOT_FOUND: { status: 404, message: '治理批次不存在' },
    MATERIAL_GOVERNANCE_RUN_TYPE_UNSUPPORTED: { status: 409, message: '该治理批次不支持此回滚操作' },
    MATERIAL_GOVERNANCE_RUN_NOT_APPLIED: { status: 409, message: '只有已执行的治理批次可以回滚' },
    MATERIAL_GOVERNANCE_RUN_EMPTY: { status: 409, message: '该治理批次没有可回滚的变更' },
    MATERIAL_GOVERNANCE_CHANGE_CORRUPT: { status: 409, message: '治理变更记录不完整，已阻止自动回滚' },
    MATERIAL_GOVERNANCE_ROLLBACK_CONFLICT: { status: 409, message: '部分物料关联已被后续业务修改，不能自动回滚' },
  };
  return messages[code] || { status: 500, message: '物料历史治理操作失败' };
};

export class MaterialController {
  async listBackfillCandidates(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialGovernanceService.listBomBackfillCandidates(req.query as never);
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Material BOM backfill preview failed', error);
      return res.status(500).json({ success: false, message: '历史 BOM 物料预览失败' });
    }
  }

  async applyBackfill(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialGovernanceService.applyBomBackfill(req.body.mappings, auditContext(req));
      return res.status(data.idempotent ? 200 : 201).json({ success: true, data });
    } catch (error) {
      logger.error('Material BOM backfill apply failed', error);
      const mapped = governanceError(error);
      return res.status(mapped.status).json({ success: false, message: mapped.message });
    }
  }

  async listGovernanceRuns(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialGovernanceService.listRuns(req.query as never);
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Material governance run list failed', error);
      return res.status(500).json({ success: false, message: '物料治理记录查询失败' });
    }
  }

  async rollbackGovernanceRun(req: AuthRequest, res: Response) {
    try {
      const data = await MaterialGovernanceService.rollbackRun(Number(req.params.runId), auditContext(req));
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Material governance rollback failed', error);
      const mapped = governanceError(error);
      return res.status(mapped.status).json({ success: false, message: mapped.message });
    }
  }

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
      const message = error instanceof Error ? error.message : '';
      return res.status(status).json({
        success: false,
        message: message === 'MATERIAL_ACTIVE_TEMPORARY'
          ? '临时物料必须先完成审核并转为正式物料，才能启用'
          : status === 409
            ? '物料编码已存在，请选择现有物料或更换唯一编码'
            : '物料主数据创建失败',
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
            : message === 'MATERIAL_RETIRED'
              ? '已停用物料不可再修改，请新建替代物料并保留历史追溯'
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
      const message = error instanceof Error ? error.message : '';
      return res.status(status).json({
        success: false,
        message: status === 404
          ? '物料不存在'
          : message === 'MATERIAL_RETIRED'
            ? '已停用物料不可再新增别名'
          : status === 409
            ? '该物料在相同语言下已存在这一别名'
            : '物料别名创建失败',
      });
    }
  }
}

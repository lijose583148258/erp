import { Response } from 'express';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { StockMovementService } from '../services/stock-movement.service';
import { StockMovementConflictError } from '../services/stock-movement.errors';
import { isMaterialReleaseReadinessError } from '../services/material-release-readiness.service';
import { buildOperationalDataScopeWhere, canUseOperationalDataScope, mergeWhereAnd } from '../utils/recordAccess';

const WAREHOUSE_DATA_SCOPE = 'warehouse_visible' as const;

function rejectWarehouseScope(res: Response) {
  return res.status(403).json({ success: false, message: '当前角色未获得仓储数据范围' } as ApiResponse);
}

const normalizeWarehouseRequestId = (value: unknown): string | null => {
  const requestId = String(value ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(requestId) ? requestId : null;
};

function respondStockConflict(res: Response, error: unknown) {
  if (isMaterialReleaseReadinessError(error)) {
    return res.status(error.statusCode).json({
      success: false,
      message: '库存过账必须使用已发布的统一物料；请先完成物料关联后重试。',
      errorCode: error.message,
      details: error.details,
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
  if (!(error instanceof StockMovementConflictError)) return null;
  return res.status(409).json({
    success: false,
    message: error.message,
    errorCode: error.code,
  } as ApiResponse);
}

/**
 * 仓储管理控制器
 * 涵盖仓库、库位、库存余额的 CRUD 操作
 */
export class WarehouseController {
  // ── 仓库 ───────────────────────────────────────────────────────

  /** 获取全部仓库（含库位列表和库存汇总） */
  async listWarehouses(req: AuthRequest, res: Response) {
    try {
      if (!canUseOperationalDataScope(req, WAREHOUSE_DATA_SCOPE)) {
        return res.json({ success: true, data: [] } as ApiResponse);
      }

      const prisma = (await import('../config/database')).default;
      const warehouses = await prisma.warehouse.findMany({
        orderBy: { id: 'asc' },
        include: {
          locations: {
            orderBy: { id: 'asc' },
            include: {
              stockBalances: {
                where: { quantity: { gt: 0 } },
                orderBy: { productName: 'asc' },
              },
            },
          },
        },
      });

      const result = warehouses.map((wh: any) => {
        let totalItems = 0;
        let totalQuantity = 0;
        for (const loc of wh.locations) {
          for (const sb of loc.stockBalances) {
            totalItems++;
            totalQuantity += Number(sb.quantity || 0);
          }
        }
        return {
          ...wh,
          createdAt: wh.createdAt?.toISOString?.() ?? wh.createdAt,
          updatedAt: wh.updatedAt?.toISOString?.() ?? wh.updatedAt,
          locations: wh.locations.map((loc: any) => ({
            ...loc,
            createdAt: loc.createdAt?.toISOString?.() ?? loc.createdAt,
            updatedAt: loc.updatedAt?.toISOString?.() ?? loc.updatedAt,
            stockBalances: loc.stockBalances.map((sb: any) => ({
              ...sb,
              lastMoveAt: sb.lastMoveAt?.toISOString?.() ?? sb.lastMoveAt,
              createdAt: sb.createdAt?.toISOString?.() ?? sb.createdAt,
              updatedAt: sb.updatedAt?.toISOString?.() ?? sb.updatedAt,
            })),
          })),
          _summary: { totalItems, totalQuantity },
        };
      });

      res.json({ success: true, data: result } as ApiResponse);
    } catch (error) {
      logger.error('获取仓库列表失败', error);
      res.status(500).json({ success: false, message: '获取仓库列表失败' } as ApiResponse);
    }
  }

  /** 创建仓库 */
  async createWarehouse(req: AuthRequest, res: Response) {
    try {
      if (!canUseOperationalDataScope(req, WAREHOUSE_DATA_SCOPE)) {
        return rejectWarehouseScope(res);
      }

      const prisma = (await import('../config/database')).default;
      const { code, name, type = 'physical' } = req.body;
      if (!code || !name) {
        return res.status(400).json({ success: false, message: '仓库编码和名称不能为空' } as ApiResponse);
      }

      const exists = await prisma.warehouse.findUnique({ where: { code: String(code) } });
      if (exists) {
        return res.status(409).json({ success: false, message: `仓库编码 ${code} 已存在` } as ApiResponse);
      }

      const created = await prisma.warehouse.create({
        data: {
          code: String(code),
          name: String(name),
          type: String(type),
          status: 'active',
        },
      });

      res.status(201).json({ success: true, data: created } as ApiResponse);
    } catch (error) {
      logger.error('创建仓库失败', error);
      res.status(500).json({ success: false, message: '创建仓库失败' } as ApiResponse);
    }
  }

  // ── 库位 ───────────────────────────────────────────────────────

  /** 创建库位 */
  async createLocation(req: AuthRequest, res: Response) {
    try {
      if (!canUseOperationalDataScope(req, WAREHOUSE_DATA_SCOPE)) {
        return rejectWarehouseScope(res);
      }

      const prisma = (await import('../config/database')).default;
      const warehouseId = Number(req.params.warehouseId);
      const { code, name, type = 'internal' } = req.body;
      if (!code || !name) {
        return res.status(400).json({ success: false, message: '库位编码和名称不能为空' } as ApiResponse);
      }

      const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) {
        return res.status(404).json({ success: false, message: '仓库不存在' } as ApiResponse);
      }

      const exists = await prisma.location.findUnique({ where: { code: String(code) } });
      if (exists) {
        return res.status(409).json({ success: false, message: `库位编码 ${code} 已存在` } as ApiResponse);
      }

      const created = await prisma.location.create({
        data: {
          warehouseId,
          code: String(code),
          name: String(name),
          type: String(type),
          status: 'active',
        },
      });

      res.status(201).json({ success: true, data: created } as ApiResponse);
    } catch (error) {
      logger.error('创建库位失败', error);
      res.status(500).json({ success: false, message: '创建库位失败' } as ApiResponse);
    }
  }

  // ── 库存余额 ───────────────────────────────────────────────────

  /** 查询全局库存台账 */
  async listStockBalances(req: AuthRequest, res: Response) {
    try {
      const prisma = (await import('../config/database')).default;
      const { materialId, productName, batchNo, warehouseId, locationId, page = '1', pageSize = '50' } = req.query;
      const pageNum = Math.max(1, Number(page));
      const size = Math.min(100, Math.max(1, Number(pageSize)));

      const where: Record<string, any> = {};
      if (materialId) where.materialId = Number(materialId);
      if (productName) where.productName = { contains: String(productName) };
      if (batchNo) where.batchNo = { contains: String(batchNo) };
      if (locationId) where.locationId = Number(locationId);
      if (warehouseId) {
        where.location = { warehouseId: Number(warehouseId) };
      }
      const scopedWhere = mergeWhereAnd(where, buildOperationalDataScopeWhere(req, WAREHOUSE_DATA_SCOPE));

      const [items, total] = await Promise.all([
        prisma.stockBalance.findMany({
          where: scopedWhere,
          orderBy: [{ productName: 'asc' }, { batchNo: 'asc' }],
          skip: (pageNum - 1) * size,
          take: size,
          include: {
            location: {
              include: { warehouse: true },
            },
          },
        }),
        prisma.stockBalance.count({ where: scopedWhere }),
      ]);

      const data = items.map((sb: any) => ({
        ...sb,
        warehouseName: sb.location?.warehouse?.name ?? '',
        warehouseCode: sb.location?.warehouse?.code ?? '',
        locationName: sb.location?.name ?? '',
        locationCode: sb.location?.code ?? '',
        lastMoveAt: sb.lastMoveAt?.toISOString?.() ?? sb.lastMoveAt,
        createdAt: sb.createdAt?.toISOString?.() ?? sb.createdAt,
        updatedAt: sb.updatedAt?.toISOString?.() ?? sb.updatedAt,
      }));

      res.json({
        success: true,
        data,
        meta: { page: pageNum, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) },
      } as ApiResponse);
    } catch (error) {
      logger.error('查询库存台账失败', error);
      res.status(500).json({ success: false, message: '查询库存台账失败' } as ApiResponse);
    }
  }

  /** 查询最近库存凭证 */
  async listStockEntries(req: AuthRequest, res: Response) {
    try {
      if (!canUseOperationalDataScope(req, WAREHOUSE_DATA_SCOPE)) {
        return res.json({ success: true, data: [] } as ApiResponse);
      }

      const limit = Number(req.query.limit || 50);
      const data = await StockMovementService.listRecentEntries(limit, {
        sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
        sourceRef: req.query.sourceRef ? String(req.query.sourceRef) : undefined,
        productName: req.query.productName ? String(req.query.productName) : undefined,
        batchNo: req.query.batchNo ? String(req.query.batchNo) : undefined,
        locationId: req.query.locationId ? Number(req.query.locationId) : undefined,
        warehouseId: req.query.warehouseId ? Number(req.query.warehouseId) : undefined,
      });
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('查询库存凭证失败', error);
      res.status(500).json({ success: false, message: '查询库存凭证失败' } as ApiResponse);
    }
  }

  /** 手动录入库存（初始入库 / 采购入库等） */
  async createStockBalance(req: AuthRequest, res: Response) {
    try {
      if (!canUseOperationalDataScope(req, WAREHOUSE_DATA_SCOPE)) {
        return rejectWarehouseScope(res);
      }

      const prisma = (await import('../config/database')).default;
      const { locationId, materialId, productName, batchNo, quantity, unit = 'kg', sourceRef, reason, note, unitCost, costAmountDelta } = req.body;

      if (!locationId || !productName || !batchNo) {
        return res.status(400).json({ success: false, message: '库位、产品名称、批次号不能为空' } as ApiResponse);
      }

      const quantityDelta = Number(quantity);
      if (!Number.isFinite(quantityDelta) || quantityDelta <= 0) {
        return res.status(400).json({ success: false, message: '入库数量必须大于 0' } as ApiResponse);
      }

      const normalizedSourceRef = String(sourceRef ?? '').trim();
      const normalizedReason = String(reason ?? '').trim();
      const normalizedNote = String(note ?? '').trim();
      if (!normalizedSourceRef || !normalizedReason) {
        return res.status(400).json({
          success: false,
          message: '应急补录 / 盘盈入库必须提供来源单号和明确原因',
        } as ApiResponse);
      }

      const location = await prisma.location.findUnique({ where: { id: Number(locationId) } });
      if (!location) {
        return res.status(404).json({ success: false, message: '库位不存在' } as ApiResponse);
      }

      const result = await StockMovementService.postStockEntry({
        sourceType: 'warehouse_manual_inbound',
        sourceRef: normalizedSourceRef,
        reason: normalizedReason,
        note: normalizedNote || null,
        createdBy: req.user?.userId || null,
        lines: [{
          locationId: Number(locationId),
          materialId: materialId ? Number(materialId) : null,
          productName: String(productName),
          batchNo: String(batchNo),
          quantityDelta,
          unit: String(unit),
          unitCost: unitCost === undefined || unitCost === null || unitCost === '' ? null : Number(unitCost),
          costAmountDelta: costAmountDelta === undefined || costAmountDelta === null || costAmountDelta === '' ? null : Number(costAmountDelta),
        }],
      });

      res.status(201).json({
        success: true,
        data: result.balances[0],
        stockEntry: result.entry,
        movements: result.movements,
        message: '库存已通过凭证入账',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    } catch (error) {
      const conflict = respondStockConflict(res, error);
      if (conflict) return conflict;
      logger.error('录入库存失败', error);
      res.status(500).json({ success: false, message: '录入库存失败' } as ApiResponse);
    }
  }

  /** 调整库存余额 */
  async updateStockBalance(req: AuthRequest, res: Response) {
    try {
      if (!canUseOperationalDataScope(req, WAREHOUSE_DATA_SCOPE)) {
        return rejectWarehouseScope(res);
      }

      const prisma = (await import('../config/database')).default;
      const id = Number(req.params.id);
      const { quantity, expectedQuantity, note } = req.body;
      const requestId = normalizeWarehouseRequestId(req.body.requestId);

      if (!requestId) {
        return res.status(400).json({ success: false, message: '库存调整必须提供合法 requestId' } as ApiResponse);
      }

      const stock = await prisma.stockBalance.findUnique({ where: { id } });
      if (!stock) {
        return res.status(404).json({ success: false, message: '库存记录不存在' } as ApiResponse);
      }

      const nextQuantity = Number(quantity);
      if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
        return res.status(400).json({ success: false, message: '调整后库存数量不能小于 0' } as ApiResponse);
      }

      const expected = Number(expectedQuantity);
      if (!Number.isFinite(expected) || expected < 0) {
        return res.status(400).json({ success: false, message: 'expectedQuantity 必须是非负数' } as ApiResponse);
      }

      const quantityDelta = nextQuantity - expected;
      if (quantityDelta === 0) {
        if (Math.abs(Number(stock.quantity || 0) - expected) > 0.000001) {
          return res.status(409).json({
            success: false,
            message: '库存已被其他操作更新，请刷新后重试。',
            errorCode: 'STOCK_MOVEMENT_CONFLICT',
          } as ApiResponse);
        }
        return res.json({
          success: true,
          data: stock,
          message: '库存数量未变化',
        } as ApiResponse);
      }

      const result = await StockMovementService.postStockEntry({
        sourceType: 'warehouse_adjustment',
        sourceRef: `warehouse_adjustment:${requestId}`,
        reason: note ? String(note) : 'manual_adjustment',
        note: note ? String(note) : null,
        createdBy: req.user?.userId || null,
        lines: [{
          locationId: stock.locationId,
          materialId: stock.materialId,
          productName: stock.productName,
          batchNo: stock.batchNo,
          quantityDelta,
          unit: stock.unit,
          expectedQuantityBefore: expected,
        }],
      });

      res.json({
        success: true,
        data: result.balances[0],
        stockEntry: result.entry,
        movements: result.movements,
        message: '库存已通过调整凭证入账',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    } catch (error) {
      const conflict = respondStockConflict(res, error);
      if (conflict) return conflict;
      logger.error('调整库存失败', error);
      res.status(500).json({ success: false, message: '调整库存失败' } as ApiResponse);
    }
  }

  /** 库位调拨：同一批次从一个库位扣减并入到另一个库位 */
  async transferStockBalance(req: AuthRequest, res: Response) {
    try {
      if (!canUseOperationalDataScope(req, WAREHOUSE_DATA_SCOPE)) {
        return rejectWarehouseScope(res);
      }

      const prisma = (await import('../config/database')).default;
      const stockBalanceId = Number(req.params.id);
      const toLocationId = Number(req.body.toLocationId);
      const quantity = Number(req.body.quantity);
      const requestId = normalizeWarehouseRequestId(req.body.requestId);

      if (!Number.isInteger(stockBalanceId) || stockBalanceId <= 0) {
        return res.status(400).json({ success: false, message: '库存记录参数不正确' } as ApiResponse);
      }
      if (!Number.isInteger(toLocationId) || toLocationId <= 0) {
        return res.status(400).json({ success: false, message: '目标库位不能为空' } as ApiResponse);
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ success: false, message: '调拨数量必须大于 0' } as ApiResponse);
      }
      if (!requestId) {
        return res.status(400).json({ success: false, message: '调拨必须提供合法 requestId，避免网络重试造成重复过账' } as ApiResponse);
      }

      const stock = await prisma.stockBalance.findUnique({
        where: { id: stockBalanceId },
        include: { location: { include: { warehouse: true } } },
      });
      if (!stock) {
        return res.status(404).json({ success: false, message: '库存记录不存在' } as ApiResponse);
      }
      if (stock.locationId === toLocationId) {
        return res.status(400).json({ success: false, message: '目标库位不能与来源库位相同' } as ApiResponse);
      }

      const destination = await prisma.location.findUnique({
        where: { id: toLocationId },
        include: { warehouse: true },
      });
      if (!destination) {
        return res.status(404).json({ success: false, message: '目标库位不存在' } as ApiResponse);
      }
      const sourceRef = `warehouse_transfer:${requestId}`;
      const result = await StockMovementService.postStockEntry({
        sourceType: 'warehouse_transfer',
        sourceRef,
        reason: 'warehouse_transfer',
        note: req.body.note ? String(req.body.note) : null,
        createdBy: req.user?.userId || null,
        lines: [
          {
            locationId: stock.locationId,
            materialId: stock.materialId,
            productName: stock.productName,
            batchNo: stock.batchNo,
            quantityDelta: -quantity,
            unit: stock.unit,
          },
          {
            locationId: toLocationId,
            materialId: stock.materialId,
            productName: stock.productName,
            batchNo: stock.batchNo,
            quantityDelta: quantity,
            unit: stock.unit,
          },
        ],
      });

      return res.status(201).json({
        success: true,
        data: {
          sourceRef,
          fromLocationId: stock.locationId,
          toLocationId,
          productName: stock.productName,
          batchNo: stock.batchNo,
          quantity,
          unit: stock.unit,
          stockEntry: result.entry,
          movements: result.movements,
          balances: result.balances,
          fromLocation: {
            code: stock.location.code,
            name: stock.location.name,
            warehouseCode: stock.location.warehouse.code,
            warehouseName: stock.location.warehouse.name,
          },
          toLocation: {
            code: destination.code,
            name: destination.name,
            warehouseCode: destination.warehouse.code,
            warehouseName: destination.warehouse.name,
          },
        },
        message: '库存调拨已通过凭证入账',
      } as ApiResponse);
    } catch (error) {
      const conflict = respondStockConflict(res, error);
      if (conflict) return conflict;
      logger.error('库存调拨失败', error);
      res.status(500).json({ success: false, message: '库存调拨失败' } as ApiResponse);
    }
  }
}

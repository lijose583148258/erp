import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { logger } from '../../utils/logger';
import { CustomerQueryService } from '../../services/customer-query.service';
import { loadCustomerForRequest, loadOrderStats } from './customer.persistence';
import { buildCustomerPayload } from './customer.payload';

export async function getCustomers(req: AuthRequest, res: Response) {
    try {
      const result = await CustomerQueryService.listCustomers(req.query, req);

      return res.json({
        success: true,
        data: result.data,
        meta: result.meta,
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户列表错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

export async function getCustomerStats(req: AuthRequest, res: Response) {
    try {
      const data = await CustomerQueryService.getCustomerStats(req);

      return res.json({
        success: true,
        data,
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户统计错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

export async function getCustomerById(req: AuthRequest, res: Response) {
    try {
      const id = Number(req.params.id);
      const customer = await loadCustomerForRequest(req, id);

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      const [statsMap] = await Promise.all([loadOrderStats([customer.id])]);

      return res.json({
        success: true,
        data: buildCustomerPayload(customer, statsMap.get(customer.id)),
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户详情错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

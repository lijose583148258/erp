import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getCustomerById as getCustomerByIdHandler,
  getCustomers as getCustomersHandler,
  getCustomerStats as getCustomerStatsHandler,
} from './customer/customer-query.controller';
import {
  createCustomer as createCustomerHandler,
  deleteCustomer as deleteCustomerHandler,
  updateCustomer as updateCustomerHandler,
} from './customer/customer-write.controller';
import {
  exportCustomers as exportCustomersHandler,
  importCustomers as importCustomersHandler,
} from './customer/customer-io.controller';
import {
  getCustomerAssets as getCustomerAssetsHandler,
  getCustomerOrders as getCustomerOrdersHandler,
  getCustomerRmas as getCustomerRmasHandler,
} from './customer/customer-relations.controller';
import {
  getCustomerPoolHistory as getCustomerPoolHistoryHandler,
  updateCustomerPool as updateCustomerPoolHandler,
} from './customer/customer-pool.controller';

export class CustomerController {
  async getCustomers(req: AuthRequest, res: Response) { return getCustomersHandler(req, res); }

  async getCustomerStats(req: AuthRequest, res: Response) { return getCustomerStatsHandler(req, res); }

  async getCustomerById(req: AuthRequest, res: Response) { return getCustomerByIdHandler(req, res); }

  async createCustomer(req: AuthRequest, res: Response) { return createCustomerHandler(req, res); }

  async updateCustomer(req: AuthRequest, res: Response) { return updateCustomerHandler(req, res); }

  async deleteCustomer(req: AuthRequest, res: Response) { return deleteCustomerHandler(req, res); }

  async importCustomers(req: AuthRequest, res: Response) { return importCustomersHandler(req, res); }

  async exportCustomers(req: AuthRequest, res: Response) { return exportCustomersHandler(req, res); }

  async getCustomerOrders(req: AuthRequest, res: Response) { return getCustomerOrdersHandler(req, res); }

  async getCustomerRmas(req: AuthRequest, res: Response) { return getCustomerRmasHandler(req, res); }

  async getCustomerAssets(req: AuthRequest, res: Response) { return getCustomerAssetsHandler(req, res); }

  async updateCustomerPool(req: AuthRequest, res: Response) { return updateCustomerPoolHandler(req, res); }

  async getCustomerPoolHistory(req: AuthRequest, res: Response) { return getCustomerPoolHistoryHandler(req, res); }
}

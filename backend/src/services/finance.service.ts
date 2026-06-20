import { AuthRequest } from '../middleware/auth';
import { FinanceSummaryService, FinanceSummary, FinanceCustomerRow, FinanceMonthlyTrendRow } from './finance-summary.service';

export type { FinanceSummary, FinanceCustomerRow, FinanceMonthlyTrendRow };

export class FinanceService {
  static async getSummary(req: AuthRequest): Promise<FinanceSummary> {
    return FinanceSummaryService.getSummary(req);
  }
}

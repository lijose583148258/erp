jest.mock('../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../services/production.service', () => ({ ProductionService: { updateWorkOrderStatus: jest.fn() } }));
jest.mock('../utils/recordAccess', () => ({ canUseOperationalDataScope: () => true }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn() } }));

import { ProductionController } from './production.controller';
import { ProductionService } from '../services/production.service';
import { ProductionCompletionValidationError } from '../services/production-completion.validation';
import { StockMovementConflictError } from '../services/stock-movement.errors';

const request = () => ({ params: { id: '1' }, body: { status: 'completed' }, user: { userId: 7 }, get: () => undefined }) as any;

describe('production completion conflict classification', () => {
  it('returns structured 409 for a frozen recipe quantity conflict, not 500', async () => {
    const error = new ProductionCompletionValidationError([{ type: 'quantity_over', severity: 'blocking', material: 'RESIN',
      expected: 10, actual: 20, unit: 'kg', message: 'RESIN consumption is above expected' }]);
    (ProductionService.updateWorkOrderStatus as jest.Mock).mockRejectedValueOnce(error);
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await new ProductionController().updateWorkOrderStatus(request(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: error.message, issues: error.issues });
  });
  it('keeps unexpected failures as 500 instead of disguising them as business conflicts', async () => {
    (ProductionService.updateWorkOrderStatus as jest.Mock).mockRejectedValueOnce(new Error('Unexpected backend failure'));
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await new ProductionController().updateWorkOrderStatus(request(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
  it('classifies typed stock conflicts as 409 independently of message language', async () => {
    (ProductionService.updateWorkOrderStatus as jest.Mock).mockRejectedValueOnce(new StockMovementConflictError('库存不足'));
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await new ProductionController().updateWorkOrderStatus(request(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(ProductionService.updateWorkOrderStatus).toHaveBeenLastCalledWith(1, 'completed', undefined, { userId: 7, ipAddress: undefined, userAgent: undefined });
  });
});

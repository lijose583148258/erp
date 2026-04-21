import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { CollectionActionController } from './collection/collection-action.controller';
import { CollectionQueryController } from './collection/collection-query.controller';
import { CollectionVerificationHoldController } from './collection/collection-verification-hold.controller';

export class CollectionController {
  private readonly queryController = new CollectionQueryController();
  private readonly actionController = new CollectionActionController();
  private readonly verificationHoldController = new CollectionVerificationHoldController();

  getSummary(req: AuthRequest, res: Response) {
    return this.queryController.getSummary(req, res);
  }

  getWorkbench(req: AuthRequest, res: Response) {
    return this.queryController.getWorkbench(req, res);
  }

  getLedger(req: AuthRequest, res: Response) {
    return this.queryController.getLedger(req, res);
  }

  getOverdueOrders(req: AuthRequest, res: Response) {
    return this.queryController.getOverdueOrders(req, res);
  }

  getMilestones(req: AuthRequest, res: Response) {
    return this.queryController.getMilestones(req, res);
  }

  getPromises(req: AuthRequest, res: Response) {
    return this.queryController.getPromises(req, res);
  }

  getDisputes(req: AuthRequest, res: Response) {
    return this.queryController.getDisputes(req, res);
  }

  getHolds(req: AuthRequest, res: Response) {
    return this.queryController.getHolds(req, res);
  }

  syncOverdue(req: AuthRequest, res: Response) {
    return this.actionController.syncOverdue(req, res);
  }

  createPromise(req: AuthRequest, res: Response) {
    return this.actionController.createPromise(req, res);
  }

  updatePromiseStatus(req: AuthRequest, res: Response) {
    return this.actionController.updatePromiseStatus(req, res);
  }

  createDispute(req: AuthRequest, res: Response) {
    return this.actionController.createDispute(req, res);
  }

  updateDisputeStatus(req: AuthRequest, res: Response) {
    return this.actionController.updateDisputeStatus(req, res);
  }

  createReminder(req: AuthRequest, res: Response) {
    return this.actionController.createReminder(req, res);
  }

  createBatchReminders(req: AuthRequest, res: Response) {
    return this.actionController.createBatchReminders(req, res);
  }

  verifyPaymentRecord(req: AuthRequest, res: Response) {
    return this.verificationHoldController.verifyPaymentRecord(req, res);
  }

  setCustomerHold(req: AuthRequest, res: Response) {
    return this.verificationHoldController.setCustomerHold(req, res);
  }

  releaseCustomerHold(req: AuthRequest, res: Response) {
    return this.verificationHoldController.releaseCustomerHold(req, res);
  }

  setOrderShipmentHold(req: AuthRequest, res: Response) {
    return this.verificationHoldController.setOrderShipmentHold(req, res);
  }

  releaseOrderShipmentHold(req: AuthRequest, res: Response) {
    return this.verificationHoldController.releaseOrderShipmentHold(req, res);
  }
}

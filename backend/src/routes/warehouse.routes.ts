import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { WarehouseController } from '../controllers/warehouse.controller';

const router = Router();
const controller = new WarehouseController();

router.use(authenticate);

// 仓库
router.get('/', authorizePermission('warehouse.read'), authRoute((req, res) => controller.listWarehouses(req, res)));
router.post('/', authorizePermission('warehouse.write'), authRoute((req, res) => controller.createWarehouse(req, res)));

// 库位
router.post(
  '/:warehouseId/locations',
  authorizePermission('warehouse.write'),
  [param('warehouseId').isInt({ min: 1 })],
  validateRequest,
  authRoute((req, res) => controller.createLocation(req, res)),
);

// 库存余额
router.get('/stock-entries', authorizePermission('warehouse.ledger.read'), authRoute((req, res) => controller.listStockEntries(req, res)));
router.get('/stock-balances', authorizePermission('warehouse.read'), authRoute((req, res) => controller.listStockBalances(req, res)));
router.post('/stock-balances', authorizePermission('warehouse.write'), authRoute((req, res) => controller.createStockBalance(req, res)));
router.patch(
  '/stock-balances/:id',
  authorizePermission('warehouse.write'),
  [
    param('id').isInt({ min: 1 }),
    body('quantity').isFloat({ min: 0 }),
    body('expectedQuantity').isFloat({ min: 0 }),
    body('requestId').isString().matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
    body('note').optional({ nullable: true }).isString().isLength({ max: 500 }),
  ],
  validateRequest,
  authRoute((req, res) => controller.updateStockBalance(req, res)),
);
router.post(
  '/stock-balances/:id/transfer',
  authorizePermission('warehouse.write'),
  [
    param('id').isInt({ min: 1 }),
    body('toLocationId').isInt({ min: 1 }),
    body('quantity').isFloat({ gt: 0 }),
    body('requestId').isString().matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
    body('note').optional({ nullable: true }).isString().isLength({ max: 500 }),
  ],
  validateRequest,
  authRoute((req, res) => controller.transferStockBalance(req, res)),
);

export default router;

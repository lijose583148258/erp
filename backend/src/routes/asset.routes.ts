import { Router } from 'express';
import { AssetController } from '../controllers/asset.controller';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { createAssetTransactionSchema, createProductBatchSchema, updateProductBatchSchema, idParamSchema } from '../validators';

const router = Router();
const assetController = new AssetController();

// 所有资产管理路由都需要认证
router.use(authenticate);

// 对接前端 asset.service.ts
router.get('/balance', authorizePermission('assets.read'), authRoute((req, res) => assetController.getBalances(req, res)));
router.get('/balance/:id', authorizePermission('assets.read'), validateZod(idParamSchema, 'params'), authRoute((req, res) => assetController.getCustomerBalances(req, res)));
router.get('/history', authorizePermission('assets.read'), authRoute((req, res) => assetController.getHistory(req, res)));
router.post('/record', authorizePermission('assets.write'), validateZod(createAssetTransactionSchema), authRoute((req, res) => assetController.createTransaction(req, res)));
router.get('/batches', authorizePermission('assets.read'), authRoute((req, res) => assetController.getBatches(req, res)));
router.post('/batches', authorizePermission('assets.write'), validateZod(createProductBatchSchema), authRoute((req, res) => assetController.createBatch(req, res)));
router.patch('/batches/:id', authorizePermission('assets.write'), validateZod(idParamSchema, 'params'), validateZod(updateProductBatchSchema), authRoute((req, res) => assetController.updateBatch(req, res)));
router.delete('/batches/:id', authorizePermission('assets.write'), validateZod(idParamSchema, 'params'), authRoute((req, res) => assetController.deleteBatch(req, res)));

// 保留原有路径兼容
router.get('/summaries', authorizePermission('assets.read'), authRoute((req, res) => assetController.getSummaries(req, res)));
router.get('/transactions', authorizePermission('assets.read'), authRoute((req, res) => assetController.getTransactions(req, res)));
router.post('/transactions', authorizePermission('assets.write'), validateZod(createAssetTransactionSchema), authRoute((req, res) => assetController.createTransaction(req, res)));

export default router;

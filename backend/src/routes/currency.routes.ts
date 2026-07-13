import { Router, Request, Response } from 'express';
import { CurrencyService } from '../services/currency.service';
import { authenticate, authorizePermission } from '../middleware/auth';
import { validateZod } from '../middleware/validateZod';
import { currencyConvertSchema } from '../validators';

const router = Router();

/**
 * GET /api/currency/rates
 * 获取当前汇率快照 (前端实时面板使用)
 * 权限: 所有已登录用户
 */
router.get('/rates', authenticate, async (_req: Request, res: Response) => {
    try {
        const snapshot = await CurrencyService.getRateSnapshotCached();
        return res.json({
            success: true,
            data: {
                baseCurrency: 'CNY',
                rates: snapshot.rates,
                lastUpdated: snapshot.lastUpdated,
                cache: snapshot.cache,
                note: '汇率基准: 1 CNY = X 外币 (中国银行现汇买入价)',
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: '汇率查询失败' });
    }
});

/**
 * POST /api/currency/sync
 * 手动触发汇率同步 (管理员使用)
 * 权限: admin / manager
 */
router.post('/sync', authenticate, authorizePermission('finance.currency.sync'), async (_req: Request, res: Response) => {
    // BOC 优先，失败则切换备用
    const bocOk = await CurrencyService.syncRatesFromBOC();
    if (!bocOk) {
        const apiOk = await CurrencyService.syncRates();
        if (!apiOk) {
            return res.status(503).json({ success: false, message: 'BOC 及备用接口均无法访问，请检查服务器网络' });
        }
    }

    const snapshot = await CurrencyService.getRateSnapshotCached();
    return res.json({
        success: true,
        message: bocOk ? 'BOC 官网实时牌价同步成功' : '备用接口同步成功（非银行官方牌价）',
        data: snapshot,
    });
});

/**
 * POST /api/currency/convert
 * 实时金额换算接口
 * body: { amount, from, to }
 */
router.post('/convert', authenticate, validateZod(currencyConvertSchema), (req: Request, res: Response) => {
    const { amount, from, to } = req.body;
    const result = CurrencyService.convert(amount, from, to);
    const record = CurrencyService.buildRecord(amount, from);
    return res.json({
        success: true,
        data: {
            from,
            to,
            amount,
            result,
            multiCurrencyRecord: record,
            display: CurrencyService.formatMultiCurrency(amount, from),
        },
    });
});

export default router;

import { logger } from '../utils/logger';

/**
 * 三国货币服务 (中国 CNY / 越南 VND / 美国 USD)
 * - 以人民币 (CNY) 为本位币
 * - 支持 USD, VND, HKD, EUR 四种交易币
 * - 双轨同步: BOC 爬虫 (主) + ExchangeRate-API (备用)
 * - 内置 4 小时缓存，防止频繁请求被封禁
 */

export type SupportedCurrency = 'CNY' | 'USD' | 'VND' | 'EUR' | 'HKD';

interface RateCache {
    rates: Record<SupportedCurrency, number>;
    lastUpdated: Date;
}

export interface MultiCurrencyAmount {
    /** 原始交易金额 */
    amount: number;
    /** 交易币种 */
    currency: SupportedCurrency;
    /** 执行汇率 (1 CNY 可换多少外币) */
    exchangeRate: number;
    /** 本位币金额 (CNY) */
    baseAmount: number;
}

export class CurrencyService {
    private static _cache: RateCache | null = null;
    private static readonly CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 小时刷新周期

    // 默认兜底汇率（BOC 和备用接口均失败时使用）
    private static readonly FALLBACK_RATES: Record<SupportedCurrency, number> = {
        CNY: 1.0,
        USD: 0.1375,   // 1 CNY ≈ 0.1375 USD
        VND: 3125.0,   // 1 CNY ≈ 3125 VND
        EUR: 0.127,
        HKD: 1.073,
    };

    // ─── 缓存管理 ─────────────────────────────────────────────────

    private static get rates(): Record<SupportedCurrency, number> {
        if (this._cache && (Date.now() - this._cache.lastUpdated.getTime()) < this.CACHE_TTL_MS) {
            return this._cache.rates;
        }
        return this.FALLBACK_RATES;
    }

    private static setCache(updates: Partial<Record<SupportedCurrency, number>>) {
        const base = this._cache?.rates ?? { ...this.FALLBACK_RATES };
        const merged = { ...base, ...updates } as Record<SupportedCurrency, number>;
        this._cache = { rates: merged, lastUpdated: new Date() };
        logger.info(`[CurrencyService] 汇率缓存更新 - USD=${merged.USD?.toFixed(6)}, VND=${merged.VND?.toFixed(2)}, EUR=${merged.EUR?.toFixed(6)}, HKD=${merged.HKD?.toFixed(6)}`);
    }

    // ─── BOC 官网爬虫 (主力同步) ─────────────────────────────────

    /**
     * 从中国银行 (BOC) 官网实时抓取全币种牌价
     * BOC 报价格式: 100 外币 = X 人民币 (现汇买入价)
     * 覆盖币种: USD (美元), EUR (欧元), HKD (港币), VND (越南盾)
     */
    static async syncRatesFromBOC(): Promise<boolean> {
        try {
            logger.info('[BOC Crawler] 启动三国全币种爬虫...');

            const response = await fetch('https://www.boc.cn/sourcedb/whpj/index.html', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                },
                signal: AbortSignal.timeout(12000),
            });

            if (!response.ok) throw new Error(`BOC 访问失败: HTTP ${response.status}`);
            const html = await response.text();

            // BOC 官网表格格式: <td>美元</td> <td>现汇买入价</td>...
            // 现汇买入价 = 100 外币能买入多少人民币
            // 换算: 1 CNY = 100 / 现汇买入价 外币
            const extractCNYRate = (cnName: string): number | null => {
                const regex = new RegExp(`<td>${cnName}</td>\\s*<td>([\\d.]+)</td>`, 'i');
                const match = html.match(regex);
                if (!match) return null;
                const bocPrice = parseFloat(match[1]); // 100 外币 = bocPrice CNY
                return parseFloat((100 / bocPrice).toFixed(8)); // 1 CNY = ? 外币
            };

            const updates: Partial<Record<SupportedCurrency, number>> = {};
            const usd = extractCNYRate('美元');
            const eur = extractCNYRate('欧元');
            const hkd = extractCNYRate('港币');
            const vnd = extractCNYRate('越南盾');

            if (usd) updates.USD = usd;
            if (eur) updates.EUR = eur;
            if (hkd) updates.HKD = hkd;
            if (vnd) updates.VND = vnd;

            if (Object.keys(updates).length === 0) {
                logger.warn('[BOC Crawler] 未能提取有效汇率，页面结构可能已变更，切换备用接口');
                return false;
            }

            this.setCache(updates);
            logger.info(`[BOC Crawler] 成功抓取: ${Object.keys(updates).join(' / ')} vs CNY`);
            return true;
        } catch (error) {
            logger.error('[BOC Crawler] 抓取异常，触发备用同步:', error);
            return false;
        }
    }

    // ─── ExchangeRate-API 备用 ────────────────────────────────────

    /**
     * 备用接口: open.er-api.com (免费，BOC 爬虫失败时自动切换)
     */
    static async syncRates(): Promise<boolean> {
        try {
            logger.info('[ExchangeRate-API] 启动备用汇率同步...');
            const res = await fetch('https://open.er-api.com/v6/latest/CNY', {
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) throw new Error(`备用接口异常: HTTP ${res.status}`);
            const data: any = await res.json();

            if (data?.rates) {
                const updates: Partial<Record<SupportedCurrency, number>> = {};
                if (data.rates.USD) updates.USD = parseFloat(data.rates.USD.toFixed(8));
                if (data.rates.VND) updates.VND = parseFloat(data.rates.VND.toFixed(4));
                if (data.rates.EUR) updates.EUR = parseFloat(data.rates.EUR.toFixed(8));
                if (data.rates.HKD) updates.HKD = parseFloat(data.rates.HKD.toFixed(8));
                this.setCache(updates);
                logger.info('[ExchangeRate-API] 备用同步成功');
                return true;
            }
            return false;
        } catch (error) {
            logger.error('[ExchangeRate-API] 备用同步失败，使用系统默认兜底汇率:', error);
            return false;
        }
    }

    // ─── 核心换算 API ─────────────────────────────────────────────

    /**
     * 货币转换 (以 CNY 为中间层进行交叉换算)
     * @param amount  原始金额
     * @param from    来源币种
     * @param to      目标币种
     */
    static convert(amount: number, from: SupportedCurrency, to: SupportedCurrency): number {
        if (from === to) return amount;
        const r = this.rates;
        // 先换算为 CNY 本位币
        const amountInCNY = from === 'CNY' ? amount : amount / r[from];
        // 再从 CNY 换算到目标币种
        const result = to === 'CNY' ? amountInCNY : amountInCNY * r[to];
        // VND 为整数货币，其余保留 4 位小数
        return to === 'VND' ? Math.round(result) : parseFloat(result.toFixed(4));
    }

    /**
     * 构建多币种金额对象 (写入数据库的四字段标准结构)
     * 对应: amount + currency + exchangeRate + baseAmount
     */
    static buildRecord(amount: number, currency: SupportedCurrency): MultiCurrencyAmount {
        const rate = this.rates[currency];
        const baseAmount = currency === 'CNY' ? amount : parseFloat((amount / rate).toFixed(4));
        return { amount, currency, exchangeRate: rate, baseAmount };
    }

    /**
     * 获取当前完整汇率快照 (供前端实时展示面板使用)
     */
    static getRateSnapshot(): { rates: Record<SupportedCurrency, number>; lastUpdated: Date | null } {
        return {
            rates: { ...this.rates },
            lastUpdated: this._cache?.lastUpdated ?? null,
        };
    }

    /**
     * 前端多币种展示格式化
     * 例: "¥1,000 CNY (≈ $137.50 / ₫3,125,000)"
     */
    static formatMultiCurrency(amount: number, from: SupportedCurrency = 'CNY'): string {
        const usd = this.convert(amount, from, 'USD');
        const vnd = this.convert(amount, from, 'VND');
        const symbols: Record<SupportedCurrency, string> = { CNY: '¥', USD: '$', VND: '₫', EUR: '€', HKD: 'HK$' };
        const sym = symbols[from];
        return `${sym}${amount.toLocaleString()} ${from}  (≈ $${usd.toFixed(2)} USD / ₫${vnd.toLocaleString()} VND)`;
    }

    /** 手动覆盖汇率 (运营后台紧急干预使用) */
    static setRates(overrides: Partial<Record<SupportedCurrency, number>>) {
        this.setCache(overrides);
    }
}

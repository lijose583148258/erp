/**
 * 智能表单填写服务
 * 解析语音/文字输入并自动提取表单字段
 */

import { callAIModel } from './aiConfig';

// 表单字段类型
export interface ExtractedFormData {
    // 通用字段
    customerName?: string;
    contactName?: string;
    phone?: string;
    email?: string;
    address?: string;

    // 订单相关
    productName?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    totalAmount?: number;
    paymentTerms?: number;
    notes?: string;

    // 样品相关
    sampleType?: string;
    weight?: number;

    // 原始输入
    rawInput: string;
    confidence: number;
    suggestions?: string[];
}

export type DocumentType = 'invoice' | 'shipment';

export interface OcrDocumentData {
    docType: DocumentType;
    customerName?: string;
    invoiceNo?: string;
    shipmentNo?: string;
    trackingNo?: string;
    batchNo?: string;
    casNo?: string;
    purity?: string;
    carrier?: string;
    productName?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    totalAmount?: number;
    date?: string;
    address?: string;
    rawText: string;
    confidence: number;
}

// 提取结果
export interface ExtractionResult {
    success: boolean;
    data: ExtractedFormData;
    message?: string;
}

// 数字单位映射
const unitMap: Record<string, string> = {
    '吨': '吨',
    '公斤': 'kg',
    '千克': 'kg',
    '斤': '斤',
    '克': 'g',
    '立方': 'm³',
    '立方米': 'm³',
    '件': '件',
    '箱': '箱',
    '包': '包',
    '袋': '袋',
    '桶': '桶',
    'ton': '吨',
    'kg': 'kg',
    'kilogram': 'kg',
    'pcs': '件',
    'pieces': '件',
    'boxes': '箱'
};

/**
 * 本地规则引擎提取
 * 使用正则表达式和关键词匹配
 */
export const extractWithLocalRules = (input: string): ExtractedFormData => {
    const result: ExtractedFormData = {
        rawInput: input,
        confidence: 0.7
    };

    const text = input.toLowerCase();

    // 提取客户名称 - 常见模式
    const customerPatterns = [
        /(?:给|向|为|to|for)\s*([^\s,，。]+(?:公司|有限|集团|贸易|化工|科技|工厂|厂))/i,
        /([^\s,，。]+(?:公司|有限|集团|贸易|化工|科技|工厂|厂))/i
    ];
    for (const pattern of customerPatterns) {
        const match = input.match(pattern);
        if (match) {
            result.customerName = match[1].trim();
            break;
        }
    }

    // 提取联系人
    const contactPatterns = [
        /(?:联系人|找|给)\s*([^\s,，。]+?)(经理|总|先生|女士|小姐)/,
        /([^\s,，。]+?)(经理|总|先生|女士|小姐)/
    ];
    for (const pattern of contactPatterns) {
        const match = input.match(pattern);
        if (match) {
            result.contactName = match[1] + match[2];
            break;
        }
    }

    // 提取产品名称 - 常见化工产品
    const products = [
        '聚乙烯', '聚丙烯', '聚氯乙烯', 'PVC', 'PE', 'PP', 'PET',
        '树脂', '塑料', '橡胶', '涂料', '胶水', '溶剂',
        '硫酸', '盐酸', '氢氧化钠', '烧碱', '纯碱'
    ];
    for (const product of products) {
        if (text.includes(product.toLowerCase())) {
            result.productName = product;
            break;
        }
    }

    // 如果没匹配到预设产品，尝试提取通用产品名
    if (!result.productName) {
        const productMatch = input.match(/(?:要|买|订|采购|需要|送|寄)\s*([^\d\s,，。]{2,8})/);
        if (productMatch) {
            result.productName = productMatch[1].trim();
        }
    }

    // 提取数量和单位
    const qtyPatterns = [
        /(\d+\.?\d*)\s*(吨|公斤|千克|斤|克|立方米?|件|箱|包|袋|桶|ton|kg|pcs)/i,
        /(\d+\.?\d*)\s*个?单位/
    ];
    for (const pattern of qtyPatterns) {
        const match = input.match(pattern);
        if (match) {
            result.quantity = parseFloat(match[1]);
            result.unit = unitMap[match[2].toLowerCase()] || match[2];
            break;
        }
    }

    // 提取价格
    const pricePatterns = [
        /(?:单价|价格|每吨?|一吨?)?\s*(\d+\.?\d*)\s*(?:元|块|¥|\$)?(?:\/|每|一)?\s*(吨|公斤|千克|kg)?/i,
        /(\d{4,})\s*(?:一吨|每吨|\/吨)/
    ];
    for (const pattern of pricePatterns) {
        const match = input.match(pattern);
        if (match) {
            const price = parseFloat(match[1]);
            // 合理价格范围判断 (化工品通常千元到万元级别)
            if (price >= 100 && price <= 100000) {
                result.unitPrice = price;
                break;
            }
        }
    }

    // 提取账期
    const termsPatterns = [
        /(\d+)\s*天?(?:账期|付款)/,
        /账期\s*(\d+)\s*天/,
        /(\d+)\s*days?/i
    ];
    for (const pattern of termsPatterns) {
        const match = input.match(pattern);
        if (match) {
            result.paymentTerms = parseInt(match[1]);
            break;
        }
    }

    // 提取重量（样品场景）
    const weightPatterns = [
        /(\d+\.?\d*)\s*(克|g|公斤|kg)/i
    ];
    for (const pattern of weightPatterns) {
        const match = input.match(pattern);
        if (match) {
            result.weight = parseFloat(match[1]);
            if (match[2].toLowerCase() === 'kg' || match[2] === '公斤') {
                result.weight *= 1000; // 转换为克
            }
            break;
        }
    }

    // 提取地址
    const addressPatterns = [
        /(?:地址|寄到|送到|发到)\s*[:：]?\s*([^\s,，。]{5,})/,
        /((?:北京|上海|广州|深圳|杭州|成都|武汉|南京|西安|重庆)[^\s,，。]{5,})/
    ];
    for (const pattern of addressPatterns) {
        const match = input.match(pattern);
        if (match) {
            result.address = match[1].trim();
            break;
        }
    }

    // 计算置信度
    let matchCount = 0;
    if (result.customerName) matchCount++;
    if (result.productName) matchCount++;
    if (result.quantity) matchCount++;
    if (result.unitPrice) matchCount++;

    result.confidence = Math.min(0.95, 0.5 + matchCount * 0.15);

    return result;
};

const parseNumberValue = (value?: string | null) => {
    if (!value) return undefined;
    const cleaned = value.replace(/[^\x00-\x7F]/g, '').replace(/[^\d.]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseOcrDocument = (input: string, docType: DocumentType): OcrDocumentData => {
    const text = input.replace(/\s+/g, ' ').trim();
    const lineSource = input.replace(/\\n/g, '\n').replace(/\r/g, '\n');
    const lines = lineSource.split('\n').map(line => line.trim()).filter(Boolean);
    const result: OcrDocumentData = {
        docType,
        rawText: input,
        confidence: 0.4
    };

    const customerMatch = input.match(
        /(?:购方|客户|客户名称|company|customer|收货方|买方|to|ship\s*to)[:：\s]*([\s\S]*?)(?=(?:\\n|\n|(?:product|产品|quantity|数量|unit|单位|carrier|承运|tracking|追踪|invoice|发票|batch|批次|cas|日期)\s*[:：]|$))/i
    );
    if (customerMatch) {
        result.customerName = customerMatch[1].replace(/\\n/g, ' ').trim();
    } else {
        const customerLine = lines.find(line => /^(?:购方|客户|客户名称|company|customer|收货方|买方|to|ship\s*to)\s*[:：]/i.test(line));
        if (customerLine) {
            result.customerName = customerLine.replace(/^(?:购方|客户|客户名称|company|customer|收货方|买方|to|ship\s*to)\s*[:：]\s*/i, '').trim();
        }
    }

    const invoiceMatch = text.match(/(?:发票号|发票号码|invoice\s*no|inv\s*no)[:：\s]*([A-Z0-9-]+)/i);
    if (invoiceMatch) result.invoiceNo = invoiceMatch[1].trim();

    const shipmentMatch = text.match(/(?:发货单号|运单号|物流单号|shipment\s*no)[:：\s]*([A-Z0-9-]+)/i);
    if (shipmentMatch) result.shipmentNo = shipmentMatch[1].trim();

    const trackingMatch = text.match(/(?:追踪号|tracking\s*no|运单号)[:：\s]*([A-Z0-9-]+)/i);
    if (trackingMatch) result.trackingNo = trackingMatch[1].trim();

    const batchMatch = text.match(/(?:批次号|批号|batch\s*no|lot\s*no)[:：\s]*([A-Z0-9-]+)/i);
    if (batchMatch) result.batchNo = batchMatch[1].trim();

    const casMatch = text.match(/(?:cas\s*号|cas\s*no|cas)[:：\s]*(\d{2,7}-\d{2}-\d)/i);
    if (casMatch) result.casNo = casMatch[1].trim();

    const purityMatch = text.match(/(?:纯度|含量|purity)[:：\s]*(\d+\.?\d*\s*%)/i);
    if (purityMatch) result.purity = purityMatch[1].trim();

    const carrierMatch = text.match(/(?:承运商|物流公司|carrier)[:：\s]*([^\n]+?)(?:\s{2,}|$)/i);
    if (carrierMatch) result.carrier = carrierMatch[1].trim();

    const productMatch = text.match(/(?:品名|货物|产品)[:：\s]*([^\n]+?)(?:数量|规格|$)/i);
    if (productMatch) {
        result.productName = productMatch[1].trim();
    } else {
        const englishProductMatch = text.match(/(?:product|item|goods)[:：\s]*([^\n]+?)(?=(?:\s+(?:quantity|qty|unit|carrier|tracking|invoice|batch|cas|date)\s*[:：])|$)/i);
        if (englishProductMatch) result.productName = englishProductMatch[1].trim();
    }

    const qtyMatch = text.match(/(\d+\.?\d*)\s*(吨|kg|公斤|千克|件|箱|包|袋|桶)/i);
    if (qtyMatch) {
        result.quantity = parseNumberValue(qtyMatch[1]);
        result.unit = unitMap[qtyMatch[2].toLowerCase()] || qtyMatch[2];
    } else {
        const englishQtyMatch = text.match(/(?:quantity|qty|数量)[:：\s]*([\d,.]+)\s*(?:unit\s*[:：]?\s*([^\s,，。]+))?/i);
        if (englishQtyMatch) {
            result.quantity = parseNumberValue(englishQtyMatch[1]);
            const rawUnit = englishQtyMatch[2]?.trim().toLowerCase();
            if (rawUnit) {
                result.unit = unitMap[rawUnit] || rawUnit;
            }
        }
    }

    if (!result.unit) {
        const unitMatch = text.match(/(?:unit|单位)[:：\s]*([^\s,，。]+)/i);
        if (unitMatch) {
            const rawUnit = unitMatch[1].trim().toLowerCase();
            result.unit = unitMap[rawUnit] || unitMatch[1].trim();
        }
    }

    const unitPriceMatch = text.match(/(?:单价|price)[:：\s]*([\d,.]+)/i);
    if (unitPriceMatch) result.unitPrice = parseNumberValue(unitPriceMatch[1]);

    const totalMatch = text.match(/(?:合计|总计|金额|total)[:：\s]*([\d,.]+)/i);
    if (totalMatch) result.totalAmount = parseNumberValue(totalMatch[1]);

    const dateMatch = text.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
    if (dateMatch) result.date = dateMatch[1].replace(/[/.]/g, '-');

    const addressMatch = text.match(/(?:地址|address)[:：\s]*([^\n]+?)(?:电话|收货人|$)/i);
    if (addressMatch) result.address = addressMatch[1].trim();

    const filled = [result.customerName, result.invoiceNo, result.shipmentNo, result.productName, result.quantity, result.totalAmount].filter(Boolean).length;
    result.confidence = Math.min(0.95, 0.35 + filled * 0.12);

    return result;
};

/**
 * 使用AI模型提取
 */
export const extractWithAI = async (input: string): Promise<ExtractedFormData> => {
    const systemPrompt = `你是一个专业的销售订单助手。请从用户的语音输入中提取关键信息。
返回JSON格式，包含以下字段（如果能识别到）：
- customerName: 客户/公司名称
- contactName: 联系人姓名
- productName: 产品名称
- quantity: 数量（数字）
- unit: 单位
- unitPrice: 单价（数字）
- paymentTerms: 账期天数
- address: 地址
- notes: 备注

只返回JSON，不要其他解释。未识别到的字段不要包含。`;

    try {
        const response = await callAIModel(input, systemPrompt);

        // 尝试解析JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                ...parsed,
                rawInput: input,
                confidence: 0.9
            };
        }
    } catch (e) {
        console.warn('AI extraction failed, falling back to local rules:', e);
    }

    // 回退到本地规则
    return extractWithLocalRules(input);
};

/**
 * 智能表单填写主函数
 */
export const smartFormFill = async (
    input: string,
    useAI: boolean = true
): Promise<ExtractionResult> => {
    if (!input.trim()) {
        return {
            success: false,
            data: { rawInput: '', confidence: 0 },
            message: '请输入或说出要填写的内容'
        };
    }

    try {
        const data = useAI
            ? await extractWithAI(input)
            : extractWithLocalRules(input);

        // 生成建议
        const suggestions: string[] = [];
        if (!data.customerName) suggestions.push('未识别到客户名称');
        if (!data.productName) suggestions.push('未识别到产品名称');
        if (!data.quantity) suggestions.push('未识别到数量');

        data.suggestions = suggestions;

        return {
            success: true,
            data,
            message: suggestions.length > 0
                ? `部分信息未识别: ${suggestions.join('、')}`
                : '信息提取成功'
        };
    } catch (e: any) {
        return {
            success: false,
            data: { rawInput: input, confidence: 0 },
            message: e.message || '解析失败'
        };
    }
};

/**
 * 匹配现有客户
 */
export const matchCustomer = (
    name: string,
    customers: Array<{ id: string; name: string; nameZh?: string; nameEn?: string; nameVi?: string; nameAliases?: string[]; displayName?: string }>
): { id: string; name: string; nameZh?: string; nameEn?: string; nameVi?: string; nameAliases?: string[]; displayName?: string } | null => {
    if (!name) return null;

    const normalizedInput = name.toLowerCase().replace(/\s+/g, '');
    const suffixes = ['有限责任公司', '有限公司', '集团', '贸易', '科技', '工厂'];

    const candidateNames = (customer: { name: string; nameZh?: string; nameEn?: string; nameVi?: string; nameAliases?: string[]; displayName?: string }) => {
        const values = [
            customer.displayName,
            customer.name,
            customer.nameZh,
            customer.nameEn,
            customer.nameVi,
            ...(customer.nameAliases || []),
        ].filter(Boolean) as string[];
        return values.map(value => value.toLowerCase().replace(/\s+/g, ''));
    };

    const normalize = (value: string) => {
        let current = value.toLowerCase().replace(/\s+/g, '');
        for (const suffix of suffixes) {
            current = current.replace(suffix, '');
        }
        return current;
    };

    const exact = customers.find(c => candidateNames(c).some(candidate => candidate === normalizedInput));
    if (exact) return exact;

    const partial = customers.find(c => candidateNames(c).some(candidate => candidate.includes(normalizedInput) || normalizedInput.includes(candidate)));
    if (partial) return partial;

    const cleanedInput = normalize(normalizedInput);
    const fuzzy = customers.find(c => candidateNames(c).some(candidate => {
        const cleanedName = normalize(candidate);
        return cleanedName.includes(cleanedInput) || cleanedInput.includes(cleanedName);
    }));

    return fuzzy || null;
};

export default {
    extractWithLocalRules,
    extractWithAI,
    smartFormFill,
    matchCustomer,
    parseOcrDocument
};

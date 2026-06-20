/**
 * 中越贸易场景优化 - 智能表格识别增强
 * 支持越南语字段识别和中越贸易特殊需求
 */

// ==================== 越南语字段映射 ====================

/**
 * 越南语字段关键词映射
 */
export const vietnameseFieldKeywords = {
  // 客户信息
  customer: {
    name: ['tên khách hàng', 'công ty', 'tên công ty', 'khách hàng', 'đơn vị'],
    contact: ['người liên hệ', 'liên hệ', 'người đại diện'],
    phone: ['điện thoại', 'số điện thoại', 'di động', 'sđt'],
    email: ['email', 'thư điện tử', 'hộp thư'],
    address: ['địa chỉ', 'nơi ở', 'trụ sở'],
    creditLimit: ['hạn mức tín dụng', 'hạn mức', 'tín dụng'],
    paymentTerms: ['điều khoản thanh toán', 'kỳ hạn', 'thời hạn thanh toán'],
    taxCode: ['mã số thuế', 'mst', 'số thuế']
  },
  
  // 订单信息
  order: {
    customer: ['khách hàng', 'tên khách hàng', 'công ty'],
    product: ['sản phẩm', 'hàng hóa', 'mặt hàng', 'tên sản phẩm'],
    quantity: ['số lượng', 'khối lượng', 'sl'],
    unit: ['đơn vị', 'đơn vị tính'],
    price: ['đơn giá', 'giá', 'giá bán'],
    amount: ['thành tiền', 'tổng tiền', 'số tiền', 'giá trị'],
    currency: ['tiền tệ', 'đơn vị tiền tệ', 'loại tiền'],
    deliveryDate: ['ngày giao hàng', 'thời gian giao', 'hạn giao']
  },
  
  // 样品信息
  sample: {
    customer: ['khách hàng', 'tên khách hàng'],
    product: ['mẫu', 'tên mẫu', 'sản phẩm mẫu'],
    spec: ['quy cách', 'thông số', 'đặc tính'],
    quantity: ['số lượng', 'sl'],
    weight: ['trọng lượng', 'khối lượng', 'cân nặng'],
    address: ['địa chỉ giao', 'địa chỉ nhận', 'nơi nhận'],
    contact: ['người nhận', 'liên hệ']
  },
  
  // 物流信息
  shipment: {
    trackingNumber: ['mã vận đơn', 'số vận đơn', 'tracking'],
    customer: ['khách hàng', 'người nhận'],
    orderNumber: ['số đơn hàng', 'mã đơn'],
    carrier: ['đơn vị vận chuyển', 'hãng vận chuyển'],
    shipDate: ['ngày gửi', 'ngày xuất hàng'],
    deliveryDate: ['ngày giao', 'dự kiến giao'],
    status: ['trạng thái', 'tình trạng']
  }
};

// ==================== 中越贸易特殊字段 ====================

/**
 * 中越贸易特殊字段识别
 */
export const chinaVietnamTradeFields = {
  // 海关和报关
  customs: {
    hsCode: ['hs编码', 'hs code', 'mã hs', 'mã hàng hóa'],
    customsDeclaration: ['报关单号', 'customs declaration', 'tờ khai hải quan'],
    importLicense: ['进口许可证', 'import license', 'giấy phép nhập khẩu'],
    exportLicense: ['出口许可证', 'export license', 'giấy phép xuất khẩu'],
    originCertificate: ['原产地证明', 'certificate of origin', 'c/o', 'giấy chứng nhận xuất xứ']
  },
  
  // 货币和汇率
  currency: {
    cny: ['人民币', 'rmb', 'cny', 'yuan', 'nhân dân tệ'],
    vnd: ['越南盾', 'vnd', 'dong', 'đồng việt nam'],
    usd: ['美元', 'usd', 'dollar', 'đô la mỹ'],
    exchangeRate: ['汇率', 'exchange rate', 'tỷ giá']
  },
  
  // 港口和物流
  logistics: {
    portOfLoading: ['起运港', 'port of loading', 'cảng xuất phát'],
    portOfDischarge: ['目的港', 'port of discharge', 'cảng đích'],
    incoterms: ['贸易术语', 'incoterms', 'điều kiện giao hàng'],
    containerNumber: ['集装箱号', 'container no', 'số container'],
    sealNumber: ['铅封号', 'seal no', 'số niêm phong']
  },
  
  // 越南特殊要求
  vietnam: {
    businessLicense: ['营业执照', 'business license', 'giấy phép kinh doanh'],
    taxCode: ['税号', 'tax code', 'mã số thuế'],
    bankAccount: ['银行账号', 'bank account', 'số tài khoản'],
    legalRepresentative: ['法人代表', 'legal representative', 'người đại diện pháp luật']
  }
};

// ==================== 增强的字段映射函数 ====================

/**
 * 创建增强的字段映射（支持中英越三语）
 */
export const createEnhancedFieldMap = (
  headers: string[], 
  fieldKeywords: Record<string, string[]>
): Record<string, number[]> => {
  const map: Record<string, number[]> = {};
  
  Object.keys(fieldKeywords).forEach(field => {
    const keywords = fieldKeywords[field];
    map[field] = headers
      .map((header, index) => {
        const headerLower = header.toLowerCase().trim();
        
        // 精确匹配
        if (keywords.some(kw => headerLower === kw.toLowerCase())) {
          return index;
        }
        
        // 包含匹配
        if (keywords.some(kw => headerLower.includes(kw.toLowerCase()))) {
          return index;
        }
        
        // 去除特殊字符后匹配
        const cleanHeader = headerLower.replace(/[^a-z0-9\u4e00-\u9fa5\u00C0-\u1EF9]/g, '');
        if (keywords.some(kw => {
          const cleanKw = kw.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5\u00C0-\u1EF9]/g, '');
          return cleanHeader.includes(cleanKw);
        })) {
          return index;
        }
        
        return -1;
      })
      .filter(index => index !== -1);
  });
  
  return map;
};

// ==================== 货币转换工具 ====================

/**
 * 中越贸易常用汇率（仅供参考）
 */
export const exchangeRates = {
  // 基准：1 CNY
  CNY_TO_VND: 3500,  // 1人民币 ≈ 3500越南盾
  CNY_TO_USD: 0.14,  // 1人民币 ≈ 0.14美元
  
  // 基准：1 USD
  USD_TO_CNY: 7.2,   // 1美元 ≈ 7.2人民币
  USD_TO_VND: 25200, // 1美元 ≈ 25200越南盾
  
  // 基准：1 VND
  VND_TO_CNY: 0.00029, // 1越南盾 ≈ 0.00029人民币
  VND_TO_USD: 0.00004  // 1越南盾 ≈ 0.00004美元
};

/**
 * 货币转换
 */
export const convertCurrency = (
  amount: number, 
  fromCurrency: 'CNY' | 'VND' | 'USD', 
  toCurrency: 'CNY' | 'VND' | 'USD'
): number => {
  if (fromCurrency === toCurrency) return amount;
  
  const rateKey = `${fromCurrency}_TO_${toCurrency}` as keyof typeof exchangeRates;
  const rate = exchangeRates[rateKey];
  
  if (!rate) {
    console.warn(`未找到汇率: ${fromCurrency} -> ${toCurrency}`);
    return amount;
  }
  
  return Math.round(amount * rate * 100) / 100;
};

/**
 * 识别货币类型
 */
export const detectCurrency = (value: string): 'CNY' | 'VND' | 'USD' | null => {
  const valueLower = value.toLowerCase().trim();
  
  if (valueLower.includes('cny') || valueLower.includes('rmb') || 
      valueLower.includes('人民币') || valueLower.includes('元')) {
    return 'CNY';
  }
  
  if (valueLower.includes('vnd') || valueLower.includes('dong') || 
      valueLower.includes('đồng') || valueLower.includes('盾')) {
    return 'VND';
  }
  
  if (valueLower.includes('usd') || valueLower.includes('dollar') || 
      valueLower.includes('美元') || valueLower.includes('$')) {
    return 'USD';
  }
  
  return null;
};

// ==================== 越南地址格式化 ====================

/**
 * 越南常见城市/省份
 */
export const vietnamProvinces = [
  'Hà Nội', 'TP Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ',
  'Bình Dương', 'Đồng Nai', 'Bà Rịa - Vũng Tàu', 'Khánh Hòa',
  'Lâm Đồng', 'Thừa Thiên Huế', 'Quảng Nam', 'Quảng Ninh',
  'Nghệ An', 'Thanh Hóa', 'Bắc Ninh', 'Hải Dương', 'Vĩnh Phúc'
];

/**
 * 格式化越南地址
 */
export const formatVietnameseAddress = (address: string): string => {
  // 移除多余空格
  let formatted = address.trim().replace(/\s+/g, ' ');
  
  // 确保省份名称大写
  vietnamProvinces.forEach(province => {
    const regex = new RegExp(province, 'gi');
    formatted = formatted.replace(regex, province);
  });
  
  return formatted;
};

// ==================== 中越贸易术语 ====================

/**
 * 常用贸易术语（中英越三语）
 */
export const tradeTerms = {
  incoterms: {
    FOB: { zh: '离岸价', en: 'Free On Board', vi: 'Giao hàng tại cảng' },
    CIF: { zh: '到岸价', en: 'Cost Insurance Freight', vi: 'Giá bao gồm vận chuyển và bảo hiểm' },
    EXW: { zh: '工厂交货', en: 'Ex Works', vi: 'Giao tại xưởng' },
    FCA: { zh: '货交承运人', en: 'Free Carrier', vi: 'Giao cho người vận chuyển' },
    CFR: { zh: '成本加运费', en: 'Cost and Freight', vi: 'Giá bao gồm vận chuyển' }
  },
  
  paymentTerms: {
    TT: { zh: '电汇', en: 'Telegraphic Transfer', vi: 'Chuyển khoản điện tín' },
    LC: { zh: '信用证', en: 'Letter of Credit', vi: 'Thư tín dụng' },
    DP: { zh: '付款交单', en: 'Documents against Payment', vi: 'Trả tiền khi nhận chứng từ' },
    DA: { zh: '承兑交单', en: 'Documents against Acceptance', vi: 'Chấp nhận khi nhận chứng từ' },
    OA: { zh: '赊账', en: 'Open Account', vi: 'Tài khoản mở' }
  },
  
  documentTypes: {
    invoice: { zh: '发票', en: 'Invoice', vi: 'Hóa đơn' },
    packingList: { zh: '装箱单', en: 'Packing List', vi: 'Danh sách đóng gói' },
    BL: { zh: '提单', en: 'Bill of Lading', vi: 'Vận đơn' },
    CO: { zh: '原产地证', en: 'Certificate of Origin', vi: 'Giấy chứng nhận xuất xứ' },
    CI: { zh: '商业发票', en: 'Commercial Invoice', vi: 'Hóa đơn thương mại' }
  }
};

// ==================== 数据验证增强 ====================

/**
 * 验证越南税号格式
 */
export const validateVietnameseTaxCode = (taxCode: string): boolean => {
  // 越南税号通常是10位或13位数字
  const cleaned = taxCode.replace(/[^0-9]/g, '');
  return cleaned.length === 10 || cleaned.length === 13;
};

/**
 * 验证中国统一社会信用代码
 */
export const validateChineseCreditCode = (code: string): boolean => {
  // 18位统一社会信用代码
  const cleaned = code.replace(/[^0-9A-Z]/g, '');
  return cleaned.length === 18;
};

/**
 * 验证电话号码（中国/越南）
 */
export const validatePhoneNumber = (phone: string, country: 'CN' | 'VN'): boolean => {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  
  if (country === 'CN') {
    // 中国手机号：11位，1开头
    return /^1[3-9]\d{9}$/.test(cleaned);
  } else {
    // 越南手机号：10位，0开头
    return /^0[0-9]{9}$/.test(cleaned);
  }
};

// ==================== 智能建议增强 ====================

/**
 * 生成中越贸易特定建议
 */
export const generateChinaVietnamTradeSuggestions = (
  data: any[], 
  type: string
): string[] => {
  const suggestions: string[] = [];
  
  // 检查货币
  const currencies = new Set<string>();
  data.forEach(item => {
    if (item.currency) currencies.add(item.currency);
  });
  
  if (currencies.size > 1) {
    suggestions.push('💱 检测到多种货币，建议统一货币单位或标注汇率');
  }
  
  // 检查地址
  const hasVietnameseAddress = data.some(item => 
    item.address && vietnamProvinces.some(p => item.address.includes(p))
  );
  
  if (hasVietnameseAddress) {
    suggestions.push('🇻🇳 检测到越南地址，请确认地址格式正确');
  }
  
  // 检查税号
  if (type === 'customer') {
    const missingTaxCode = data.filter(item => !item.taxCode && !item.businessLicense);
    if (missingTaxCode.length > 0) {
      suggestions.push(`⚠️ ${missingTaxCode.length} 个客户缺少税号或营业执照信息`);
    }
  }
  
  // 检查贸易术语
  if (type === 'order') {
    const hasIncoterms = data.some(item => item.incoterms);
    if (!hasIncoterms) {
      suggestions.push('📋 建议添加贸易术语（FOB/CIF/EXW等）');
    }
  }
  
  return suggestions;
};

export default {
  vietnameseFieldKeywords,
  chinaVietnamTradeFields,
  createEnhancedFieldMap,
  exchangeRates,
  convertCurrency,
  detectCurrency,
  vietnamProvinces,
  formatVietnameseAddress,
  tradeTerms,
  validateVietnameseTaxCode,
  validateChineseCreditCode,
  validatePhoneNumber,
  generateChinaVietnamTradeSuggestions
};

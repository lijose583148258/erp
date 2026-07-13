// 多语言工具 - 自动回退和校正
import { translations } from '../translations';

const translationMap = translations as Record<Language, Record<string, string>>;
import type { Language } from '../types';

/**
 * 安全的翻译函数 - 带自动回退
 * 如果目标语言不存在，自动使用中文
 */
export function t(key: string, lang: Language = 'zh'): string {
  // 优先使用目标语言
  if (translationMap[lang]?.[key]) {
    return translationMap[lang][key];
  }
  
  // 回退到中文
  if (translationMap.zh?.[key]) {
    console.warn(`[i18n] Missing ${lang}.${key}, fallback to zh`);
    return translationMap.zh[key];
  }
  
  // 都不存在，返回键名（开发模式）
  console.error(`[i18n] Missing translation key: ${key}`);
  return `[${key}]`;
}

/**
 * 批量翻译
 */
export function tBatch(keys: string[], lang: Language = 'zh'): Record<string, string> {
  const result: Record<string, string> = {};
  keys.forEach(key => {
    result[key] = t(key, lang);
  });
  return result;
}

/**
 * 检查翻译完整性
 */
export function checkTranslationCompleteness(): {
  total: number;
  en: { count: number; percentage: number; missing: string[] };
  vi: { count: number; percentage: number; missing: string[] };
} {
  const zhKeys = Object.keys(translations.zh);
  const enKeys = Object.keys(translations.en || {});
  const viKeys = Object.keys(translations.vi || {});
  
  const missingEn = zhKeys.filter(k => !enKeys.includes(k));
  const missingVi = zhKeys.filter(k => !viKeys.includes(k));
  
  return {
    total: zhKeys.length,
    en: {
      count: enKeys.length,
      percentage: Math.round((enKeys.length / zhKeys.length) * 100),
      missing: missingEn,
    },
    vi: {
      count: viKeys.length,
      percentage: Math.round((viKeys.length / zhKeys.length) * 100),
      missing: missingVi,
    },
  };
}

/**
 * 生成翻译报告
 */
export function generateI18nReport(): string {
  const report = checkTranslationCompleteness();
  
  let output = '='.repeat(60) + '\n';
  output += 'Pro客户销售系统 - 翻译完整性报告\n';
  output += '='.repeat(60) + '\n\n';
  
  output += `📊 统计信息:\n`;
  output += `  中文(zh): ${report.total} 个键 (基准)\n`;
  output += `  英文(en): ${report.en.count} 个键 (${report.en.percentage}%)\n`;
  output += `  越南语(vi): ${report.vi.count} 个键 (${report.vi.percentage}%)\n\n`;
  
  if (report.en.missing.length > 0) {
    output += `⚠️  英文缺失: ${report.en.missing.length} 个键\n`;
    if (report.en.missing.length <= 10) {
      output += `   ${report.en.missing.join(', ')}\n`;
    } else {
      output += `   前10个: ${report.en.missing.slice(0, 10).join(', ')}...\n`;
    }
    output += '\n';
  }
  
  if (report.vi.missing.length > 0) {
    output += `⚠️  越南语缺失: ${report.vi.missing.length} 个键\n`;
    if (report.vi.missing.length <= 10) {
      output += `   ${report.vi.missing.join(', ')}\n`;
    } else {
      output += `   前10个: ${report.vi.missing.slice(0, 10).join(', ')}...\n`;
    }
    output += '\n';
  }
  
  if (report.en.missing.length === 0 && report.vi.missing.length === 0) {
    output += '✅ 所有语言翻译完整！\n\n';
  } else {
    output += '💡 建议:\n';
    output += '  1. 使用 t() 函数自动回退到中文\n';
    output += '  2. 补全缺失的翻译键\n';
    output += '  3. 使用翻译API自动生成\n\n';
  }
  
  output += '='.repeat(60) + '\n';
  
  return output;
}

/**
 * 自动补全翻译（使用中文作为后备）
 */
export function autoFillTranslations(lang: Language): Record<string, string> {
  const zhKeys = Object.keys(translationMap.zh);
  const result: Record<string, string> = { ...translationMap[lang] };
  
  zhKeys.forEach(key => {
    if (!result[key]) {
      result[key] = translationMap.zh[key]; // 使用中文作为后备
    }
  });
  
  return result;
}

/**
 * 导出缺失的翻译键（用于翻译）
 */
export function exportMissingKeys(lang: Language): { key: string; zh: string }[] {
  const zhKeys = Object.keys(translationMap.zh);
  const langKeys = Object.keys(translationMap[lang] || {});
  const missing = zhKeys.filter(k => !langKeys.includes(k));
  
  return missing.map(key => ({
    key,
    zh: translationMap.zh[key],
  }));
}

/**
 * 格式化货币
 */
export function formatCurrency(amount: number, currency: string, _lang: Language = 'zh'): string {
  const symbols: Record<string, string> = {
    CNY: '¥',
    USD: '$',
    VND: '₫',
  };
  
  const symbol = symbols[currency] || currency;
  
  if (currency === 'VND') {
    // 越南盾不显示小数
    return `${symbol}${Math.round(amount).toLocaleString()}`;
  }
  
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * 格式化日期
 */
export function formatDate(date: Date | string, lang: Language = 'zh'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  const formats: Record<Language, Intl.DateTimeFormatOptions> = {
    zh: { year: 'numeric', month: '2-digit', day: '2-digit' },
    en: { year: 'numeric', month: 'short', day: 'numeric' },
    vi: { year: 'numeric', month: '2-digit', day: '2-digit' },
  };
  
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'vi' ? 'vi-VN' : 'en-US', formats[lang]);
}

/**
 * React Hook: 使用翻译
 */
export function useTranslation(lang: Language = 'zh') {
  return {
    t: (key: string) => t(key, lang),
    tBatch: (keys: string[]) => tBatch(keys, lang),
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, lang),
    formatDate: (date: Date | string) => formatDate(date, lang),
  };
}

export default {
  t,
  tBatch,
  checkTranslationCompleteness,
  generateI18nReport,
  autoFillTranslations,
  exportMissingKeys,
  formatCurrency,
  formatDate,
  useTranslation,
};

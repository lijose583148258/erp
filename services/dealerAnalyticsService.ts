/**
 * 经销商综合表现分析引擎 (上帝视角)
 * 专门用于分析分散在不同物理库中的经销商经营情况
 */
export const DealerAnalyticsService = {
  /**
   * 计算经销商的“健康得分”
   * 维度：回款速度、客户增长、订单频次、高风险客户占比
   */
  calculateHealthScore: (stats: {
    totalRevenue: number;
    orderCount: number;
    highRiskCustomers: number;
    averageCollectionDays: number; // 模拟字段
    expiringBatches?: number;
    expiredBatches?: number;
    inventoryRisk?: number;
  }) => {
    let score = 100;

    // 1. 风险减分：高风险客户每增加一个扣5分
    score -= stats.highRiskCustomers * 5;

    // 2. 回款效率：超过45天回款开始扣分
    if (stats.averageCollectionDays > 45) {
      score -= (stats.averageCollectionDays - 45) * 2;
    }

    // 3. 活跃度加分：订单量贡献
    score += Math.min(stats.orderCount / 10, 20);

    const expiringPenalty = (stats.expiringBatches || 0) * 2;
    const expiredPenalty = (stats.expiredBatches || 0) * 5;
    const inventoryPenalty = Math.min(stats.inventoryRisk || 0, 20);
    score -= expiringPenalty + expiredPenalty + inventoryPenalty;

    return Math.max(0, Math.min(score, 100));
  },

  /**
   * 经销商整理分析逻辑
   * 识别出“僵尸经销商”和“高潜经销商”
   */
  segmentDealers: (dealers: any[]) => {
    return dealers.map(d => {
      const score = DealerAnalyticsService.calculateHealthScore({
        ...d,
        averageCollectionDays: 30 // 默认值
      });

      let status = 'Standard';
      if (score > 85) status = 'Premium (High Potential)';
      if (score < 40) status = 'At Risk (Zombie)';

      return {
        ...d,
        healthScore: score,
        segment: status,
        actionAdvice: score < 40
          ? '建议缩减授信额度或更换负责人，并优先清理临期库存'
          : d.expiringBatches > 0
            ? '建议加快临期批次出库，并持续扶持渠道动销'
            : '建议加大市场补贴支持'
      };
    });
  },

  /**
   * 经销商库存风险预测
   * 识别哪些经销商正在囤货或库存积压
   */
  predictInventoryRisk: (dealerId: string, salesTrend: number[], stockLevel: number) => {
    const avgSales = salesTrend.reduce((a: number, b: number) => a + b, 0) / (salesTrend.length || 1);
    const monthsOfStock = stockLevel / (avgSales || 1);

    if (monthsOfStock > 6) return 'Overstocking Risk';
    if (monthsOfStock < 1) return 'Out of Stock Risk';
    return 'Healthy';
  }
};

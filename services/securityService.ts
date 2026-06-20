export type UserRole = 'admin' | 'manager' | 'sales' | 'warehouse' | 'finance';
export type UserSegment = 'direct' | 'channel' | 'mixed';

/**
 * 资源隔离安全服务
 * 确保内部员工与经销商之间的数据隔离
 */
export const SecurityService = {
  /**
   * 获取用户可访问的数据范围过滤器 (Prisma Where Clause)
   */
  getAccessFilter: (user: { role: string; segment?: string; id: number }) => {
    // 管理员：全量访问
    if (user.role === 'admin') {
      return {};
    }

    // 经理级别：根据业务段隔离 (直营 vs 渠道)
    if (user.role === 'manager') {
      if (user.segment === 'mixed' || !user.segment) {
        return {};
      }
      return {
        segment: user.segment === 'direct' ? 'direct' : 'channel'
      };
    }

    // 普通销售：只能看到自己负责的客户且符合业务段
    if (user.role === 'sales') {
      return {
        salespersonId: user.id,
        segment: user.segment || 'direct'
      };
    }

    // 其他角色（如财务/仓管）：通常按业务段过滤
    if (!user.segment || user.segment === 'mixed') {
      return {};
    }
    return {
      segment: user.segment
    };
  },

  /**
   * 检查用户是否有权访问特定资源
   */
  canAccess: (user: { role: string; segment?: string; id: number }, resource: { segment?: string | null; salespersonId?: number | null }) => {
    if (user.role === 'admin') return true;

    // 检查业务段隔离
    if (user.segment && user.segment !== 'mixed' && resource.segment !== user.segment) {
      return false;
    }

    // 检查销售个人隔离
    if (user.role === 'sales' && resource.salespersonId !== user.id) {
      return false;
    }

    return true;
  },

  /**
   * 脱敏逻辑：针对不同角色隐藏敏感数据
   */
  sanitizeData: <T extends Record<string, any>>(data: T, role: string): Partial<T> => {
    const sensitiveFields = ['costPrice', 'margin', 'supplierInfo'];
    
    // 如果不是管理员或财务，脱敏敏感字段
    if (role !== 'admin' && role !== 'finance') {
      const sanitized = { ...data };
      sensitiveFields.forEach(field => {
        if (field in sanitized) {
          delete sanitized[field];
        }
      });
      return sanitized;
    }
    
    return data;
  }
};

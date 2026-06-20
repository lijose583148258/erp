import prisma from '../config/database';
import { runtime } from '../config/runtime';

type WorkflowNode = {
  code: string;
  name?: string;
  assigneeRole?: string;
  assigneeUserId?: number;
};

type WorkflowConfig = {
  nodes: WorkflowNode[];
};

const workflowCodePattern = /^[a-z][a-z0-9_-]{1,63}$/;

const normalizeWorkflowNode = (node: WorkflowNode, index: number): WorkflowNode => {
  const code = String(node?.code || '').trim();
  if (!workflowCodePattern.test(code)) {
    throw new Error(`工作流节点 ${index + 1} 的 code 无效，必须使用小写字母、数字、下划线或短横线。`);
  }

  const assigneeRole = node.assigneeRole ? String(node.assigneeRole).trim() : undefined;
  const assigneeUserId = Number(node.assigneeUserId || 0) > 0 ? Number(node.assigneeUserId) : undefined;
  if (!assigneeRole && !assigneeUserId) {
    throw new Error(`工作流节点 ${code} 必须配置 assigneeRole 或 assigneeUserId。`);
  }

  return {
    code,
    name: node.name ? String(node.name).trim().slice(0, 100) : code,
    assigneeRole,
    assigneeUserId,
  };
};

const normalizeWorkflowConfig = (config?: Partial<WorkflowConfig>): WorkflowConfig => {
  const rawNodes = Array.isArray(config?.nodes) && config?.nodes.length
    ? config.nodes
    : [defaultWorkflowNode];
  const nodes = rawNodes.map(normalizeWorkflowNode);
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.code)) {
      throw new Error(`工作流节点 code 重复：${node.code}`);
    }
    seen.add(node.code);
  }
  return { nodes };
};

const parseConfig = (value: string): WorkflowConfig => {
  const parsed = JSON.parse(value || '{}') as Partial<WorkflowConfig>;
  return normalizeWorkflowConfig(parsed);
};

const defaultWorkflowNode: WorkflowNode = {
  code: 'manager_approval',
  name: '经理审批',
  assigneeRole: 'manager',
};

const firstNode = (config: WorkflowConfig) => config.nodes[0] || defaultWorkflowNode;

const nextNode = (config: WorkflowConfig, currentStep: number) => config.nodes[currentStep + 1] || null;

export const commercialPlatformService = {
  async listWorkflowDefinitions() {
    return prisma.$queryRawUnsafe('SELECT * FROM workflow_definitions ORDER BY created_at DESC');
  },

  async createWorkflowDefinition(input: {
    code: string;
    name: string;
    documentType: string;
    config: WorkflowConfig;
    createdBy?: number;
  }) {
    const config = normalizeWorkflowConfig(input.config);
    const configJson = JSON.stringify(config);
    await prisma.$executeRawUnsafe(
      `INSERT INTO workflow_definitions (code, name, document_type, config_json, created_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name,
         document_type = excluded.document_type,
         config_json = excluded.config_json,
         is_active = 1,
         updated_at = CURRENT_TIMESTAMP`,
      input.code,
      input.name,
      input.documentType,
      configJson,
      input.createdBy || null,
    );
    const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM workflow_definitions WHERE code = ?', input.code);
    return rows[0];
  },

  async createWorkflowInstance(input: {
    definitionCode: string;
    documentType: string;
    documentId: string;
    requesterId?: number;
  }) {
    const definitions = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM workflow_definitions WHERE code = ? AND is_active = 1', input.definitionCode);
    const definition = definitions[0];
    if (!definition) throw new Error(`Workflow definition not found: ${input.definitionCode}`);
    const config = parseConfig(definition.config_json);
    const node = firstNode(config);

    await prisma.$executeRawUnsafe(
      `INSERT INTO workflow_instances (definition_id, document_type, document_id, status, current_step, requester_id)
       VALUES (?, ?, ?, 'pending', 0, ?)`,
      definition.id,
      input.documentType,
      input.documentId,
      input.requesterId || null,
    );
    const instances = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM workflow_instances WHERE rowid = last_insert_rowid()');
    const instance = instances[0];

    await prisma.$executeRawUnsafe(
      `INSERT INTO workflow_tasks (instance_id, node_code, assignee_role, assignee_user_id)
       VALUES (?, ?, ?, ?)`,
      instance.id,
      node.code,
      node.assigneeRole || null,
      node.assigneeUserId || null,
    );
    await this.createNotification({
      role: node.assigneeRole || 'manager',
      type: 'workflow',
      severity: 'warning',
      title: '新的审批待办',
      message: `${input.documentType} ${input.documentId} 需要审批`,
      resourceType: input.documentType,
      resourceId: input.documentId,
    });

    return instance;
  },

  async listWorkflowTasks(user: { userId: number; role: string }) {
    return prisma.$queryRawUnsafe(
      `SELECT t.*, i.document_type, i.document_id, i.status AS instance_status
       FROM workflow_tasks t
       JOIN workflow_instances i ON i.id = t.instance_id
       WHERE t.status = 'pending'
         AND (t.assignee_user_id = ? OR t.assignee_role = ? OR ? = 'admin')
       ORDER BY t.created_at DESC`,
      user.userId,
      user.role,
      user.role,
    );
  },

  async actOnWorkflowTask(input: { taskId: number; action: 'approve' | 'reject'; actorId: number; comment?: string }) {
    const tasks = await prisma.$queryRawUnsafe<any[]>(
      `SELECT t.*, i.definition_id, i.current_step, i.document_type, i.document_id
       FROM workflow_tasks t
       JOIN workflow_instances i ON i.id = t.instance_id
       WHERE t.id = ? AND t.status = 'pending'`,
      input.taskId,
    );
    const task = tasks[0];
    if (!task) throw new Error('Pending workflow task not found');

    await prisma.$executeRawUnsafe(
      `UPDATE workflow_tasks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      input.action === 'approve' ? 'approved' : 'rejected',
      input.taskId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO workflow_actions (instance_id, task_id, action, actor_id, comment)
       VALUES (?, ?, ?, ?, ?)`,
      task.instance_id,
      input.taskId,
      input.action,
      input.actorId,
      input.comment || null,
    );

    if (input.action === 'reject') {
      await prisma.$executeRawUnsafe(
        `UPDATE workflow_instances SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        task.instance_id,
      );
      return { instanceId: task.instance_id, status: 'rejected' };
    }

    const definitions = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM workflow_definitions WHERE id = ?', task.definition_id);
    const config = parseConfig(definitions[0]?.config_json || '{}');
    const node = nextNode(config, Number(task.current_step || 0));
    if (!node) {
      await prisma.$executeRawUnsafe(
        `UPDATE workflow_instances SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        task.instance_id,
      );
      return { instanceId: task.instance_id, status: 'approved' };
    }

    await prisma.$executeRawUnsafe(
      `UPDATE workflow_instances SET current_step = current_step + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      task.instance_id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO workflow_tasks (instance_id, node_code, assignee_role, assignee_user_id)
       VALUES (?, ?, ?, ?)`,
      task.instance_id,
      node.code,
      node.assigneeRole || null,
      node.assigneeUserId || null,
    );
    return { instanceId: task.instance_id, status: 'pending' };
  },

  async createNotification(input: {
    userId?: number;
    role?: string;
    type?: string;
    severity?: string;
    title: string;
    message: string;
    resourceType?: string;
    resourceId?: string;
  }) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO notifications (user_id, role, type, severity, title, message, resource_type, resource_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.userId || null,
      input.role || null,
      input.type || 'info',
      input.severity || 'info',
      input.title,
      input.message,
      input.resourceType || null,
      input.resourceId || null,
    );
    const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM notifications WHERE rowid = last_insert_rowid()');
    return rows[0];
  },

  async listNotifications(user: { userId: number; role: string }) {
    return prisma.$queryRawUnsafe(
      `SELECT * FROM notifications
       WHERE (user_id = ? OR role = ? OR role IS NULL)
       ORDER BY is_read ASC, created_at DESC
       LIMIT 100`,
      user.userId,
      user.role,
    );
  },

  async markNotificationRead(id: number, user: { userId: number; role: string }) {
    await prisma.$executeRawUnsafe(
      `UPDATE notifications
       SET is_read = 1, read_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (user_id = ? OR role = ? OR role IS NULL)`,
      id,
      user.userId,
      user.role,
    );
  },

  async getPlatformReadiness() {
    const [
      workflowDefinitionRows,
      workflowTaskRows,
      alertRuleRows,
      notificationRows,
      biSummary,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>('SELECT COUNT(*) AS count FROM workflow_definitions WHERE is_active = 1').catch(() => [{ count: 0 }]),
      prisma.$queryRawUnsafe<any[]>("SELECT COUNT(*) AS count FROM workflow_tasks WHERE status = 'pending'").catch(() => [{ count: 0 }]),
      prisma.$queryRawUnsafe<any[]>('SELECT COUNT(*) AS count FROM alert_rules').catch(() => [{ count: 0 }]),
      prisma.$queryRawUnsafe<any[]>("SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0").catch(() => [{ count: 0 }]),
      this.getBiSummary().catch(() => ({
        orders: 0,
        revenue: 0,
        customers: 0,
        lowStock: 0,
        pendingWorkflow: 0,
      })),
    ]);

    const checks = [
      {
        code: 'database-mode',
        status: runtime.deploymentMode === 'saas' && runtime.databaseEngine !== 'postgresql' ? 'blocking' : 'passed',
        message: runtime.deploymentMode === 'saas'
          ? 'SaaS 模式要求 PostgreSQL。'
          : '当前为本地/私有部署模式，可以使用 SQLite 稳定包。',
      },
      {
        code: 'postgres-artifact',
        status: runtime.databaseEngine === 'postgresql' ? 'blocking' : 'watch',
        message: runtime.databaseEngine === 'postgresql'
          ? '当前 SQLite Prisma 构建不允许直接连接 PostgreSQL，需要使用 PostgreSQL 专用构建产物。'
          : '已保留 PostgreSQL 迁移探针和 ADR，当前纯净包仍按 SQLite 本地版运行。',
      },
      {
        code: 'workflow-engine',
        status: Number(workflowDefinitionRows[0]?.count || 0) > 0 ? 'passed' : 'watch',
        message: '工作流定义、实例、任务、动作表已纳入平台治理。',
      },
      {
        code: 'bi-alerts',
        status: Number(alertRuleRows[0]?.count || 0) > 0 ? 'passed' : 'watch',
        message: 'BI summary 和 alert_rules 已纳入平台治理。',
      },
      {
        code: 'observability',
        status: 'passed',
        message: '/metrics 已提供 Prometheus 文本指标，/health 已提供健康检查。',
      },
    ];

    return {
      deployment: {
        mode: runtime.deploymentMode,
        databaseEngine: runtime.databaseEngine,
        nodeEnv: runtime.nodeEnv,
        port: runtime.port,
      },
      counts: {
        activeWorkflowDefinitions: Number(workflowDefinitionRows[0]?.count || 0),
        pendingWorkflowTasks: Number(workflowTaskRows[0]?.count || 0),
        alertRules: Number(alertRuleRows[0]?.count || 0),
        unreadNotifications: Number(notificationRows[0]?.count || 0),
      },
      biSummary,
      checks,
      status: checks.some(item => item.status === 'blocking')
        ? 'blocked'
        : checks.some(item => item.status === 'watch')
          ? 'watch'
          : 'ready',
    };
  },

  async getBiSummary() {
    const orderRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS order_count, COALESCE(SUM(final_amount), 0) AS revenue_amount FROM orders`,
    ).catch(() => [{ order_count: 0, revenue_amount: 0 }]);
    const customerRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS customer_count FROM customers`,
    ).catch(() => [{ customer_count: 0 }]);
    const stockRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS low_stock_count FROM stock_balances WHERE quantity <= 10`,
    ).catch(() => [{ low_stock_count: 0 }]);
    const workflowRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS pending_workflow_count FROM workflow_tasks WHERE status = 'pending'`,
    );
    return {
      orders: Number(orderRows[0]?.order_count || 0),
      revenue: Number(orderRows[0]?.revenue_amount || 0),
      customers: Number(customerRows[0]?.customer_count || 0),
      lowStock: Number(stockRows[0]?.low_stock_count || 0),
      pendingWorkflow: Number(workflowRows[0]?.pending_workflow_count || 0),
    };
  },

  async runAlertRules(actorId?: number) {
    const summary = await this.getBiSummary();
    const created = [];
    if (summary.lowStock > 0) {
      created.push(await this.createNotification({
        role: 'warehouse',
        type: 'alert',
        severity: 'warning',
        title: '库存不足预警',
        message: `当前有 ${summary.lowStock} 条库存低于默认阈值`,
        resourceType: 'stock',
      }));
    }
    if (summary.pendingWorkflow > 0) {
      created.push(await this.createNotification({
        userId: actorId,
        type: 'alert',
        severity: 'info',
        title: '审批积压提醒',
        message: `当前有 ${summary.pendingWorkflow} 条审批待处理`,
        resourceType: 'workflow',
      }));
    }
    return { summary, createdCount: created.length };
  },
};

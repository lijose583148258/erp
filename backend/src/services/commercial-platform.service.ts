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

const mapWorkflowDefinition = (definition: {
  id: number;
  code: string;
  name: string;
  documentType: string;
  configJson: string;
  isActive: boolean;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: definition.id,
  code: definition.code,
  name: definition.name,
  document_type: definition.documentType,
  config_json: definition.configJson,
  is_active: definition.isActive,
  created_by: definition.createdBy,
  created_at: definition.createdAt,
  updated_at: definition.updatedAt,
});

const mapWorkflowInstance = (instance: {
  id: number;
  definitionId: number;
  documentType: string;
  documentId: string;
  status: string;
  currentStep: number;
  requesterId: number | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: instance.id,
  definition_id: instance.definitionId,
  document_type: instance.documentType,
  document_id: instance.documentId,
  status: instance.status,
  current_step: instance.currentStep,
  requester_id: instance.requesterId,
  created_at: instance.createdAt,
  updated_at: instance.updatedAt,
});

const mapWorkflowTask = (task: {
  id: number;
  instanceId: number;
  nodeCode: string;
  assigneeRole: string | null;
  assigneeUserId: number | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
}) => ({
  id: task.id,
  instance_id: task.instanceId,
  node_code: task.nodeCode,
  assignee_role: task.assigneeRole,
  assignee_user_id: task.assigneeUserId,
  status: task.status,
  created_at: task.createdAt,
  completed_at: task.completedAt,
});

const mapNotification = (notification: {
  id: number;
  userId: number | null;
  role: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}) => ({
  id: notification.id,
  user_id: notification.userId,
  role: notification.role,
  type: notification.type,
  severity: notification.severity,
  title: notification.title,
  message: notification.message,
  resource_type: notification.resourceType,
  resource_id: notification.resourceId,
  is_read: notification.isRead,
  created_at: notification.createdAt,
  read_at: notification.readAt,
});

export const commercialPlatformService = {
  async listWorkflowDefinitions() {
    const definitions = await prisma.workflowDefinition.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return definitions.map(mapWorkflowDefinition);
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
    const definition = await prisma.workflowDefinition.upsert({
      where: { code: input.code },
      create: {
        code: input.code,
        name: input.name,
        documentType: input.documentType,
        configJson,
        createdBy: input.createdBy || null,
      },
      update: {
        name: input.name,
        documentType: input.documentType,
        configJson,
        isActive: true,
      },
    });
    return mapWorkflowDefinition(definition);
  },

  async createWorkflowInstance(input: {
    definitionCode: string;
    documentType: string;
    documentId: string;
    requesterId?: number;
  }) {
    const definition = await prisma.workflowDefinition.findFirst({
      where: { code: input.definitionCode, isActive: true },
    });
    if (!definition) throw new Error(`Workflow definition not found: ${input.definitionCode}`);
    const config = parseConfig(definition.configJson);
    const node = firstNode(config);

    const createdInstance = await prisma.workflowInstance.create({
      data: {
        definitionId: Number(definition.id),
        documentType: input.documentType,
        documentId: input.documentId,
        status: 'pending',
        currentStep: 0,
        requesterId: input.requesterId || null,
      },
    });
    const instance = mapWorkflowInstance(createdInstance);

    await prisma.workflowTask.create({
      data: {
        instanceId: instance.id,
        nodeCode: node.code,
        assigneeRole: node.assigneeRole || null,
        assigneeUserId: node.assigneeUserId || null,
      },
    });
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
    const tasks = await prisma.workflowTask.findMany({
      where: {
        status: 'pending',
        OR: [
          { assigneeUserId: user.userId },
          { assigneeRole: user.role },
          ...(user.role === 'admin' ? [{}] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const instanceIds = Array.from(new Set(tasks.map(task => task.instanceId)));
    const instances = instanceIds.length > 0
      ? await prisma.workflowInstance.findMany({
          where: { id: { in: instanceIds } },
          select: { id: true, documentType: true, documentId: true, status: true },
        })
      : [];
    const instanceMap = new Map(instances.map(instance => [instance.id, instance]));
    return tasks.map((task) => {
      const instance = instanceMap.get(task.instanceId);
      return {
        ...mapWorkflowTask(task),
        document_type: instance?.documentType,
        document_id: instance?.documentId,
        instance_status: instance?.status,
      };
    });
  },

  async actOnWorkflowTask(input: { taskId: number; action: 'approve' | 'reject'; actorId: number; comment?: string }) {
    const task = await prisma.workflowTask.findFirst({
      where: { id: input.taskId, status: 'pending' },
    });
    if (!task) throw new Error('Pending workflow task not found');
    const instance = await prisma.workflowInstance.findUnique({
      where: { id: task.instanceId },
    });
    if (!instance) throw new Error('Workflow instance not found');

    await prisma.workflowTask.update({
      where: { id: input.taskId },
      data: {
        status: input.action === 'approve' ? 'approved' : 'rejected',
        completedAt: new Date(),
      },
    });
    await prisma.workflowAction.create({
      data: {
        instanceId: task.instanceId,
        taskId: input.taskId,
        action: input.action,
        actorId: input.actorId,
        comment: input.comment || null,
      },
    });

    if (input.action === 'reject') {
      await prisma.workflowInstance.update({
        where: { id: task.instanceId },
        data: { status: 'rejected' },
      });
      return { instanceId: task.instanceId, status: 'rejected' };
    }

    const definition = await prisma.workflowDefinition.findUnique({
      where: { id: instance.definitionId },
    });
    const config = parseConfig(definition?.configJson || '{}');
    const node = nextNode(config, Number(instance.currentStep || 0));
    if (!node) {
      await prisma.workflowInstance.update({
        where: { id: task.instanceId },
        data: { status: 'approved' },
      });
      return { instanceId: task.instanceId, status: 'approved' };
    }

    await prisma.workflowInstance.update({
      where: { id: task.instanceId },
      data: { currentStep: { increment: 1 } },
    });
    await prisma.workflowTask.create({
      data: {
        instanceId: task.instanceId,
        nodeCode: node.code,
        assigneeRole: node.assigneeRole || null,
        assigneeUserId: node.assigneeUserId || null,
      },
    });
    return { instanceId: task.instanceId, status: 'pending' };
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
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId || null,
        role: input.role || null,
        type: input.type || 'info',
        severity: input.severity || 'info',
        title: input.title,
        message: input.message,
        resourceType: input.resourceType || null,
        resourceId: input.resourceId || null,
      },
    });
    return mapNotification(notification);
  },

  async listNotifications(user: { userId: number; role: string }) {
    const notifications = await prisma.notification.findMany({
      where: {
        OR: [
          { userId: user.userId },
          { role: user.role },
          { role: null },
        ],
      },
      orderBy: [
        { isRead: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 100,
    });
    return notifications.map(mapNotification);
  },

  async markNotificationRead(id: number, user: { userId: number; role: string }) {
    await prisma.notification.updateMany({
      where: {
        id,
        OR: [
          { userId: user.userId },
          { role: user.role },
          { role: null },
        ],
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  },

  async getPlatformReadiness() {
    const [
      activeWorkflowDefinitions,
      pendingWorkflowTasks,
      alertRules,
      unreadNotifications,
      biSummary,
    ] = await Promise.all([
      prisma.workflowDefinition.count({ where: { isActive: true } }).catch(() => 0),
      prisma.workflowTask.count({ where: { status: 'pending' } }).catch(() => 0),
      prisma.alertRule.count().catch(() => 0),
      prisma.notification.count({ where: { isRead: false } }).catch(() => 0),
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
        status: activeWorkflowDefinitions > 0 ? 'passed' : 'watch',
        message: '工作流定义、实例、任务、动作表已纳入平台治理。',
      },
      {
        code: 'bi-alerts',
        status: alertRules > 0 ? 'passed' : 'watch',
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
        activeWorkflowDefinitions,
        pendingWorkflowTasks,
        alertRules,
        unreadNotifications,
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
    const [orderSummary, customers, lowStock, pendingWorkflow] = await Promise.all([
      prisma.order.aggregate({
        _count: { id: true },
        _sum: { finalAmount: true },
      }).catch(() => ({ _count: { id: 0 }, _sum: { finalAmount: 0 } })),
      prisma.customer.count().catch(() => 0),
      prisma.stockBalance.count({ where: { quantity: { lte: 10 } } }).catch(() => 0),
      prisma.workflowTask.count({ where: { status: 'pending' } }),
    ]);
    return {
      orders: Number(orderSummary._count.id || 0),
      revenue: Number(orderSummary._sum.finalAmount || 0),
      customers,
      lowStock,
      pendingWorkflow,
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

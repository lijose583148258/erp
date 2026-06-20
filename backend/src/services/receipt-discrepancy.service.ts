import { buildBusinessNo } from '../utils/businessNo';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import type { TransactionClient } from './stock-movement.service';
import type {
  CreateReceiptDiscrepancyActionInput,
  CreateReceiptDiscrepancyCaseInput,
  CreateReceiptToleranceRuleInput,
  ReceiptDiscrepancyCaseFilters,
  ReceiptDiscrepancyCounterpartyType,
  ReceiptDiscrepancyModule,
  ReceiptDiscrepancySourceType,
  ReceiptDiscrepancyStatus,
  ReceiptDiscrepancyType,
  ReceiptToleranceAction,
  ReceiptToleranceCounterpartyType,
  ReceiptToleranceDiscrepancyType,
  ReceiptToleranceSourceType,
} from './receipt-discrepancy.types';
import {
  VALID_COUNTERPARTIES,
  VALID_MODULES,
  VALID_SOURCE_TYPES,
  VALID_STATUSES,
  VALID_TOLERANCE_COUNTERPARTIES,
  VALID_TOLERANCE_DISCREPANCY_TYPES,
  VALID_TOLERANCE_SOURCE_TYPES,
  normalizeDiscrepancyActionStatus,
  normalizeDiscrepancyActionType,
  normalizeDiscrepancyType,
  normalizeToleranceAction,
  resolveAutoStatus,
  resolveDefaultSuggestedAction,
  validateCreateInput,
} from './receipt-discrepancy.policy';
import {
  ACTION_SELECT_SQL,
  CASE_SELECT_SQL,
  RULE_SELECT_SQL,
  type RawRow,
  normalizeActionRow,
  normalizeCaseRow,
  normalizeRuleRow,
} from './receipt-discrepancy.rows';
import { resolveToleranceDecision } from './receipt-discrepancy.tolerance';

export type { ReceiptDiscrepancyStatus } from './receipt-discrepancy.types';

export class ReceiptDiscrepancyService {
  static normalizeDiscrepancyType(value: unknown, fallback: ReceiptDiscrepancyType) {
    return normalizeDiscrepancyType(value, fallback);
  }

  static async createCaseForRejectedReceipt(tx: TransactionClient, input: CreateReceiptDiscrepancyCaseInput) {
    const rejectedQuantity = Number(input.quantity || 0);
    if (!Number.isFinite(rejectedQuantity) || rejectedQuantity <= 0.000001) {
      return null;
    }
    validateCreateInput(input);
    const discrepancyType = normalizeDiscrepancyType(
      input.discrepancyType,
      input.sourceType === 'purchase_receipt' ? 'short_shipped' : 'customer_short_signed',
    );
    const decision = await resolveToleranceDecision(tx, {
      sourceType: input.sourceType,
      discrepancyType,
      counterpartyType: input.counterpartyType,
      counterpartyId: input.counterpartyId ?? null,
      productName: input.productName,
      quantity: rejectedQuantity,
      referenceQuantity: input.referenceQuantity ?? null,
    });
    if (decision.action === 'block') {
      throw new AppError('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', 409, ErrorCode.CONFLICT, {
        discrepancyType,
        quantity: rejectedQuantity,
        toleranceRuleId: decision.ruleId,
        tolerancePercent: decision.tolerancePercent,
        toleranceQuantity: decision.toleranceQuantity,
        varianceRate: decision.varianceRate,
      });
    }

    const existing = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE source_type = ? AND source_ref = ? LIMIT 1`,
      input.sourceType,
      input.sourceRef,
    );
    if (existing.length > 0) {
      return normalizeCaseRow(existing[0]);
    }

    const caseNo = buildBusinessNo('DSC');
    const status = resolveAutoStatus(decision.action);
    const resolvedBy = status === 'resolved' ? (input.createdBy ?? null) : null;
    const resolvedAtSql = status === 'resolved' ? 'CURRENT_TIMESTAMP' : 'NULL';
    const resolution = status === 'resolved' ? 'Auto resolved by receipt tolerance rule' : null;
    await tx.$executeRawUnsafe(
      `INSERT INTO receipt_discrepancy_cases
        (case_no, source_type, source_ref, source_id, related_module, related_id, business_ref,
         counterparty_type, counterparty_id, counterparty_name, product_name, quantity, unit,
         discrepancy_type, reason, severity, status, tolerance_rule_id, tolerance_action, tolerance_percent,
         tolerance_quantity, variance_rate, within_tolerance, requires_quality_check, suggested_action, resolution,
         note, created_by, resolved_by, resolved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${resolvedAtSql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      caseNo,
      input.sourceType,
      input.sourceRef,
      input.sourceId ?? null,
      input.relatedModule,
      Number(input.relatedId),
      input.businessRef ?? null,
      input.counterpartyType,
      input.counterpartyId ?? null,
      input.counterpartyName ?? null,
      input.productName,
      rejectedQuantity,
      input.unit || 'kg',
      discrepancyType,
      input.reason || 'Receipt discrepancy pending review',
      input.severity || decision.severity || 'normal',
      status,
      decision.ruleId,
      decision.action,
      decision.tolerancePercent,
      decision.toleranceQuantity,
      decision.varianceRate,
      decision.withinTolerance ? 1 : 0,
      decision.requiresQualityCheck ? 1 : 0,
      input.suggestedAction ?? resolveDefaultSuggestedAction(discrepancyType, input.sourceType),
      resolution,
      input.note ?? null,
      input.createdBy ?? null,
      resolvedBy,
    );

    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE case_no = ? LIMIT 1`,
      caseNo,
    );
    return rows.length > 0 ? normalizeCaseRow(rows[0]) : null;
  }

  static async listToleranceRules(tx: TransactionClient, filters: {
    sourceType?: string;
    discrepancyType?: string;
    counterpartyType?: string;
    status?: string;
    page: number;
    pageSize: number;
  }) {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.sourceType) {
      where.push('source_type = ?');
      params.push(filters.sourceType);
    }
    if (filters.discrepancyType) {
      where.push('discrepancy_type = ?');
      params.push(filters.discrepancyType);
    }
    if (filters.counterpartyType) {
      where.push('counterparty_type = ?');
      params.push(filters.counterpartyType);
    }
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const [items, countRows] = await Promise.all([
      tx.$queryRawUnsafe<RawRow[]>(
        `${RULE_SELECT_SQL}${whereSql} ORDER BY priority ASC, id DESC LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      ),
      tx.$queryRawUnsafe(
        `SELECT COUNT(*) AS count FROM receipt_tolerance_rules${whereSql}`,
        ...params,
      ) as Promise<Array<{ count: unknown }>>,
    ]);

    return {
      items: items.map(normalizeRuleRow),
      total: Number(countRows[0]?.count || 0),
      page,
      pageSize,
    };
  }

  static async createToleranceRule(tx: TransactionClient, input: CreateReceiptToleranceRuleInput, createdBy?: number | null) {
    const sourceType = String(input.sourceType || 'all') as ReceiptToleranceSourceType;
    const discrepancyType = String(input.discrepancyType || 'all') as ReceiptToleranceDiscrepancyType;
    const counterpartyType = String(input.counterpartyType || 'all') as ReceiptToleranceCounterpartyType;
    if (!VALID_TOLERANCE_SOURCE_TYPES.has(sourceType)) throw new Error(`Invalid sourceType: ${sourceType}`);
    if (!VALID_TOLERANCE_DISCREPANCY_TYPES.has(discrepancyType)) throw new Error(`Invalid discrepancyType: ${discrepancyType}`);
    if (!VALID_TOLERANCE_COUNTERPARTIES.has(counterpartyType)) throw new Error(`Invalid counterpartyType: ${counterpartyType}`);

    const actionWithinTolerance = normalizeToleranceAction(input.actionWithinTolerance, 'warn');
    const actionOutsideTolerance = normalizeToleranceAction(input.actionOutsideTolerance, 'manual_review');
    const ruleNo = buildBusinessNo('DTR');

    await tx.$executeRawUnsafe(
      `INSERT INTO receipt_tolerance_rules
        (rule_no, name, source_type, discrepancy_type, counterparty_type, counterparty_id, product_name,
         quantity_tolerance_percent, quantity_tolerance_abs, action_within_tolerance, action_outside_tolerance,
         severity_within_tolerance, severity_outside_tolerance, requires_quality_check, status, priority, note,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ruleNo,
      input.name,
      sourceType,
      discrepancyType,
      counterpartyType,
      input.counterpartyId ?? null,
      input.productName || null,
      Number(input.quantityTolerancePercent || 0),
      Number(input.quantityToleranceAbs || 0),
      actionWithinTolerance,
      actionOutsideTolerance,
      input.severityWithinTolerance || 'low',
      input.severityOutsideTolerance || 'normal',
      input.requiresQualityCheck ? 1 : 0,
      input.status || 'active',
      Number(input.priority || 100),
      input.note || null,
      createdBy ?? null,
    );

    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${RULE_SELECT_SQL} WHERE rule_no = ? LIMIT 1`,
      ruleNo,
    );
    return rows.length > 0 ? normalizeRuleRow(rows[0]) : null;
  }

  static async listActions(tx: TransactionClient, caseId: number) {
    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${ACTION_SELECT_SQL} WHERE case_id = ? ORDER BY id DESC`,
      Number(caseId),
    );
    return rows.map(normalizeActionRow);
  }

  static async createAction(tx: TransactionClient, caseId: number, input: CreateReceiptDiscrepancyActionInput) {
    const caseRows = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE id = ? LIMIT 1`,
      Number(caseId),
    );
    if (caseRows.length === 0) return null;

    const discrepancyCase = normalizeCaseRow(caseRows[0]);
    const actionType = normalizeDiscrepancyActionType(input.actionType);
    let status = normalizeDiscrepancyActionStatus(input.status, 'pending');
    let targetModule: string | null = null;
    let targetId: number | null = null;
    let targetRef: string | null = null;
    let postedAtSql = 'NULL';

    const existingRows = await tx.$queryRawUnsafe<RawRow[]>(
      `${ACTION_SELECT_SQL} WHERE case_id = ? AND action_type = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`,
      discrepancyCase.id,
      actionType,
    );
    if (existingRows.length > 0) {
      return normalizeActionRow(existingRows[0]);
    }

    if (discrepancyCase.status === 'resolved' || discrepancyCase.status === 'cancelled') {
      throw new Error('已关闭的差异单不能再新增处置动作。');
    }

    if (actionType === 'customer_rma') {
      if (discrepancyCase.counterpartyType !== 'customer' || !discrepancyCase.counterpartyId) {
        throw new Error('只有客户签收差异单才能转售后处理。');
      }

      const customerRows = await tx.$queryRawUnsafe(
        'SELECT id, status FROM customers WHERE id = ? LIMIT 1',
        discrepancyCase.counterpartyId,
      ) as Array<{ id: number; status: string }>;
      if (customerRows.length === 0) {
        throw new Error('未找到差异单对应客户，无法创建售后单。');
      }
      if (String(customerRows[0].status || 'active') !== 'active') {
        throw new Error('客户不是启用状态，无法创建售后单。');
      }

      const rmaNo = buildBusinessNo('RMA');
      await tx.$executeRawUnsafe(
        `INSERT INTO rmas
          (rma_no, customer_id, product_name, quantity, unit, reason, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        rmaNo,
        discrepancyCase.counterpartyId,
        discrepancyCase.productName,
        Number(input.quantity ?? discrepancyCase.quantity),
        input.unit || discrepancyCase.unit || 'kg',
        input.note || discrepancyCase.reason || '签收差异转售后处理',
        input.createdBy ?? discrepancyCase.createdBy ?? 1,
      );

      const rmaRows = await tx.$queryRawUnsafe(
        'SELECT id, rma_no AS rmaNo FROM rmas WHERE rma_no = ? LIMIT 1',
        rmaNo,
      ) as Array<{ id: number; rmaNo: string }>;
      targetModule = 'rma';
      targetId = Number(rmaRows[0]?.id || 0) || null;
      targetRef = rmaNo;
      status = 'approved';
    }

    if (actionType === 'close_no_action') {
      status = 'posted';
      postedAtSql = 'CURRENT_TIMESTAMP';
    }

    const actionNo = buildBusinessNo('DCA');
    await tx.$executeRawUnsafe(
      `INSERT INTO receipt_discrepancy_actions
        (action_no, case_id, action_type, status, source_module, source_ref, target_module, target_id, target_ref,
         quantity, unit, amount, currency, reason_code, disposition_code, note, created_by, approved_by, posted_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${postedAtSql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      actionNo,
      discrepancyCase.id,
      actionType,
      status,
      discrepancyCase.relatedModule,
      discrepancyCase.sourceRef,
      targetModule,
      targetId,
      targetRef,
      input.quantity ?? discrepancyCase.quantity,
      input.unit || discrepancyCase.unit || null,
      input.amount ?? null,
      input.currency || 'CNY',
      input.reasonCode || null,
      input.dispositionCode || null,
      input.note || null,
      input.createdBy ?? null,
      status === 'posted' ? (input.createdBy ?? null) : null,
    );

    await tx.$executeRawUnsafe(
      `UPDATE receipt_discrepancy_cases
       SET action_ref = ?,
           status = CASE WHEN status = 'pending' THEN 'in_review' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      actionNo,
      discrepancyCase.id,
    );

    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${ACTION_SELECT_SQL} WHERE action_no = ? LIMIT 1`,
      actionNo,
    );
    return rows.length > 0 ? normalizeActionRow(rows[0]) : null;
  }

  static async listCases(tx: TransactionClient, filters: ReceiptDiscrepancyCaseFilters) {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.sourceType) {
      if (!VALID_SOURCE_TYPES.has(filters.sourceType as ReceiptDiscrepancySourceType)) {
        throw new Error(`Invalid sourceType: ${filters.sourceType}`);
      }
      where.push('source_type = ?');
      params.push(filters.sourceType);
    }

    if (filters.sourceRef) {
      where.push('source_ref = ?');
      params.push(filters.sourceRef);
    }

    if (filters.status) {
      if (!VALID_STATUSES.has(filters.status as ReceiptDiscrepancyStatus)) {
        throw new Error(`Invalid status: ${filters.status}`);
      }
      where.push('status = ?');
      params.push(filters.status);
    }

    if (filters.relatedModule) {
      if (!VALID_MODULES.has(filters.relatedModule as ReceiptDiscrepancyModule)) {
        throw new Error(`Invalid relatedModule: ${filters.relatedModule}`);
      }
      where.push('related_module = ?');
      params.push(filters.relatedModule);
    }

    if (filters.relatedId) {
      where.push('related_id = ?');
      params.push(Number(filters.relatedId));
    }

    if (filters.counterpartyType) {
      if (!VALID_COUNTERPARTIES.has(filters.counterpartyType as ReceiptDiscrepancyCounterpartyType)) {
        throw new Error(`Invalid counterpartyType: ${filters.counterpartyType}`);
      }
      where.push('counterparty_type = ?');
      params.push(filters.counterpartyType);
    }

    if (filters.counterpartyId) {
      where.push('counterparty_id = ?');
      params.push(Number(filters.counterpartyId));
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const [items, countRows] = await Promise.all([
      tx.$queryRawUnsafe<RawRow[]>(
        `${CASE_SELECT_SQL}${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      ),
      tx.$queryRawUnsafe(
        `SELECT COUNT(*) AS count FROM receipt_discrepancy_cases${whereSql}`,
        ...params,
      ) as Promise<Array<{ count: unknown }>>,
    ]);

    return {
      items: items.map(normalizeCaseRow),
      total: Number(countRows[0]?.count || 0),
      page,
      pageSize,
    };
  }

  static async resolveCase(tx: TransactionClient, input: {
    id: number;
    status: ReceiptDiscrepancyStatus;
    resolution?: string | null;
    actionRef?: string | null;
    note?: string | null;
    resolvedBy?: number | null;
  }) {
    if (!VALID_STATUSES.has(input.status)) {
      throw new Error(`Invalid status: ${input.status}`);
    }

    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE id = ? LIMIT 1`,
      Number(input.id),
    );
    if (rows.length === 0) {
      return null;
    }

    const isTerminal = input.status === 'resolved' || input.status === 'cancelled';
    await tx.$executeRawUnsafe(
      `UPDATE receipt_discrepancy_cases
       SET status = ?,
           resolution = COALESCE(?, resolution),
           action_ref = COALESCE(?, action_ref),
           note = COALESCE(?, note),
           resolved_by = CASE WHEN ? THEN ? ELSE resolved_by END,
           resolved_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE resolved_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      input.status,
      input.resolution ?? null,
      input.actionRef ?? null,
      input.note ?? null,
      isTerminal ? 1 : 0,
      input.resolvedBy ?? null,
      isTerminal ? 1 : 0,
      Number(input.id),
    );

    const updated = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE id = ? LIMIT 1`,
      Number(input.id),
    );
    return updated.length > 0 ? normalizeCaseRow(updated[0]) : null;
  }
}

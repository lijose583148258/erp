import type { TransactionClient } from './stock-movement.service';
import { queryRawCompat } from '../utils/raw-sql-compat';
import type {
  ReceiptDiscrepancyCounterpartyType,
  ReceiptDiscrepancySourceType,
  ReceiptDiscrepancyType,
} from './receipt-discrepancy.types';
import {
  DEFAULT_TOLERANCE_DECISION,
  defaultRequiresQualityCheck,
} from './receipt-discrepancy.policy';
import {
  RULE_SELECT_SQL,
  type RawRow,
  normalizeRuleRow,
} from './receipt-discrepancy.rows';

export async function resolveToleranceDecision(tx: TransactionClient, input: {
  sourceType: ReceiptDiscrepancySourceType;
  discrepancyType: ReceiptDiscrepancyType;
  counterpartyType: ReceiptDiscrepancyCounterpartyType;
  counterpartyId?: number | null;
  productName: string;
  quantity: number;
  referenceQuantity?: number | null;
}) {
  const rows = await queryRawCompat<RawRow[]>(tx, 
    `${RULE_SELECT_SQL}
     WHERE status = 'active'
       AND (source_type = 'all' OR source_type = ?)
       AND (discrepancy_type = 'all' OR discrepancy_type = ?)
       AND (counterparty_type = 'all' OR counterparty_type = ?)
       AND (counterparty_id IS NULL OR counterparty_id = ?)
       AND (product_name IS NULL OR product_name = ?)
     ORDER BY
       (CASE WHEN source_type = ? THEN 32 ELSE 0 END
       + CASE WHEN discrepancy_type = ? THEN 16 ELSE 0 END
       + CASE WHEN counterparty_id = ? THEN 8 ELSE 0 END
       + CASE WHEN counterparty_type = ? THEN 4 ELSE 0 END
       + CASE WHEN product_name = ? THEN 2 ELSE 0 END) DESC,
       priority ASC,
       id DESC
     LIMIT 1`,
    input.sourceType,
    input.discrepancyType,
    input.counterpartyType,
    input.counterpartyId ?? null,
    input.productName,
    input.sourceType,
    input.discrepancyType,
    input.counterpartyId ?? null,
    input.counterpartyType,
    input.productName,
  );

  const rule = rows.length > 0 ? normalizeRuleRow(rows[0]) : null;
  if (!rule) {
    return {
      ...DEFAULT_TOLERANCE_DECISION,
      requiresQualityCheck: defaultRequiresQualityCheck(input.discrepancyType),
    };
  }

  const quantity = Math.max(0, Number(input.quantity || 0));
  const referenceQuantity = Math.max(0, Number(input.referenceQuantity || 0));
  const percentLimit = referenceQuantity > 0 ? referenceQuantity * (rule.quantityTolerancePercent / 100) : 0;
  const absLimit = Math.max(0, Number(rule.quantityToleranceAbs || 0));
  const toleranceQuantity = Math.max(percentLimit, absLimit);
  const withinTolerance = toleranceQuantity > 0 && quantity <= toleranceQuantity + 0.000001;
  const action = withinTolerance ? rule.actionWithinTolerance : rule.actionOutsideTolerance;
  const varianceRate = referenceQuantity > 0 ? Number(((quantity / referenceQuantity) * 100).toFixed(6)) : null;

  return {
    ruleId: rule.id,
    action,
    tolerancePercent: rule.quantityTolerancePercent,
    toleranceQuantity,
    varianceRate,
    withinTolerance,
    requiresQualityCheck: rule.requiresQualityCheck || defaultRequiresQualityCheck(input.discrepancyType),
    severity: withinTolerance ? rule.severityWithinTolerance : rule.severityOutsideTolerance,
  };
}

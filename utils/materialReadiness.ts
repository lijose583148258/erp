export const MATERIAL_RELEASE_REQUIRED = 'MATERIAL_RELEASE_REQUIRED';
export const MATERIAL_READINESS_EVENT = 'ailaoda:material-readiness-required';

export type MaterialReadinessIssue = {
  lineKey: string;
  rowNumber: number;
  materialId: number | null;
  materialCode: string | null;
  displayName: string;
  reason: 'missing_material_id' | 'material_not_found' | 'material_inactive' | 'material_temporary' | 'unit_mismatch';
  requestedUnit: string | null;
  baseUnit: string | null;
};

export type MaterialReadinessDetails = {
  contract: 'material-release-readiness/v1';
  entityType: string;
  entityId: string | null;
  action: string;
  issueCount: number;
  issues: MaterialReadinessIssue[];
  repairRoute: '/materials';
  retryableAfterRepair: true;
};

export const parseMaterialReadinessDetails = (value: unknown): MaterialReadinessDetails | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.contract !== 'material-release-readiness/v1' || !Array.isArray(record.issues)) return null;
  const issues = record.issues.filter((issue): issue is MaterialReadinessIssue => {
    if (!issue || typeof issue !== 'object') return false;
    const item = issue as Record<string, unknown>;
    return typeof item.lineKey === 'string'
      && Number.isInteger(Number(item.rowNumber))
      && typeof item.displayName === 'string'
      && typeof item.reason === 'string';
  });
  if (issues.length === 0) return null;
  return {
    contract: 'material-release-readiness/v1',
    entityType: String(record.entityType || ''),
    entityId: record.entityId == null ? null : String(record.entityId),
    action: String(record.action || ''),
    issueCount: issues.length,
    issues,
    repairRoute: '/materials',
    retryableAfterRepair: true,
  };
};

export const getMaterialReadinessIssueLabel = (issue: MaterialReadinessIssue) => {
  const reasonLabels: Record<MaterialReadinessIssue['reason'], string> = {
    missing_material_id: '尚未选择统一物料',
    material_not_found: '关联物料已不存在',
    material_inactive: '关联物料未启用',
    material_temporary: '关联物料仍是临时草稿',
    unit_mismatch: `单位不一致：当前 ${issue.requestedUnit || '-'}，主数据 ${issue.baseUnit || '-'}`,
  };
  return reasonLabels[issue.reason] || '物料状态不符合过账要求';
};

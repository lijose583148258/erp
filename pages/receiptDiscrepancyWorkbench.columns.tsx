import { EnterpriseColumn } from '../components/ui/EnterpriseDataGrid';
import { StatusBadge } from '../components/ui/StatusBadge';
import {
  type ReceiptDiscrepancyCase,
  type ReceiptToleranceRule,
} from '../services/receiptDiscrepancy.service';
import {
  actionLabels,
  buildCaseSearchText,
  buildRuleSearchText,
  counterpartyLabels,
  discrepancyTypeLabels,
  formatNumber,
  sourceTypeLabels,
  statusLabels,
} from './receiptDiscrepancyWorkbench.config';

export const caseColumns: EnterpriseColumn<ReceiptDiscrepancyCase>[] = [
  {
    key: 'caseNo',
    header: '差异单',
    width: '150px',
    sortable: true,
    searchText: buildCaseSearchText,
    render: (row) => (
      <div>
        <p className="font-black text-slate-900 dark:text-white">{row.caseNo}</p>
        <p className="text-xs font-bold text-slate-400">{sourceTypeLabels[row.sourceType] || row.sourceType}</p>
      </div>
    ),
  },
  {
    key: 'counterparty',
    header: '对象',
    width: '180px',
    sortable: true,
    searchText: buildCaseSearchText,
    render: (row) => (
      <div>
        <p className="font-bold text-slate-700 dark:text-slate-200">{row.counterpartyName || '-'}</p>
        <p className="text-xs text-slate-400">{counterpartyLabels[row.counterpartyType] || row.counterpartyType}</p>
      </div>
    ),
  },
  {
    key: 'productName',
    header: '货品',
    sortable: true,
    searchText: buildCaseSearchText,
    render: (row) => (
      <div>
        <p className="font-bold">{row.productName}</p>
        <p className="text-xs text-slate-400">{row.quantity} {row.unit}</p>
      </div>
    ),
  },
  {
    key: 'discrepancyType',
    header: '差异类型',
    width: '150px',
    sortable: true,
    searchText: buildCaseSearchText,
    render: (row) => discrepancyTypeLabels[row.discrepancyType] || row.discrepancyType,
  },
  {
    key: 'tolerance',
    header: '容差判定',
    width: '170px',
    searchText: buildCaseSearchText,
    render: (row) => (
      <div className="space-y-1">
        <StatusBadge status={row.toleranceAction} label={actionLabels[row.toleranceAction] || row.toleranceAction} />
        <p className="text-xs text-slate-400">
          偏差 {formatNumber(row.varianceRate)}% / 容差 {formatNumber(row.toleranceQuantity)}
        </p>
      </div>
    ),
  },
  {
    key: 'status',
    header: '状态',
    width: '130px',
    sortable: true,
    render: (row) => <StatusBadge status={row.status} label={statusLabels[row.status] || row.status} />,
  },
  {
    key: 'actionRef',
    header: '处置动作',
    width: '170px',
    sortable: true,
    searchText: buildCaseSearchText,
    render: (row) => row.actionRef ? (
      <div>
        <p className="font-black text-slate-900 dark:text-white">{row.actionRef}</p>
        <p className="text-xs font-bold text-emerald-500">已接后续动作</p>
      </div>
    ) : (
      <span className="text-xs font-bold text-slate-400">待发起</span>
    ),
  },
  {
    key: 'createdAt',
    header: '创建时间',
    width: '150px',
    sortable: true,
    render: (row) => new Date(row.createdAt).toLocaleString(),
  },
];

export const ruleColumns: EnterpriseColumn<ReceiptToleranceRule>[] = [
  {
    key: 'ruleNo',
    header: '规则号',
    width: '170px',
    sortable: true,
    searchText: buildRuleSearchText,
    render: (row) => (
      <div>
        <p className="font-black text-slate-900 dark:text-white">{row.ruleNo}</p>
        <p className="text-xs font-bold text-slate-400">{row.name}</p>
      </div>
    ),
  },
  {
    key: 'scope',
    header: '适用范围',
    searchText: buildRuleSearchText,
    render: (row) => (
      <div>
        <p className="font-bold">{sourceTypeLabels[row.sourceType] || row.sourceType}</p>
        <p className="text-xs text-slate-400">
          {discrepancyTypeLabels[row.discrepancyType] || row.discrepancyType} / {counterpartyLabels[row.counterpartyType] || row.counterpartyType}
        </p>
      </div>
    ),
  },
  {
    key: 'productName',
    header: '货品匹配',
    width: '170px',
    searchText: buildRuleSearchText,
    render: (row) => row.productName || '全部货品',
  },
  {
    key: 'tolerance',
    header: '容差',
    width: '160px',
    render: (row) => (
      <div>
        <p className="font-black">{formatNumber(row.quantityTolerancePercent)}%</p>
        <p className="text-xs text-slate-400">或 {formatNumber(row.quantityToleranceAbs)} 绝对量</p>
      </div>
    ),
  },
  {
    key: 'actions',
    header: '动作',
    width: '180px',
    searchText: buildRuleSearchText,
    render: (row) => (
      <div className="space-y-1">
        <p className="text-xs font-bold text-slate-400">范围内：{actionLabels[row.actionWithinTolerance]}</p>
        <p className="text-xs font-bold text-slate-400">超范围：{actionLabels[row.actionOutsideTolerance]}</p>
      </div>
    ),
  },
  {
    key: 'status',
    header: '状态',
    width: '120px',
    render: (row) => <StatusBadge status={row.status} label={statusLabels[row.status] || row.status} />,
  },
  {
    key: 'priority',
    header: '优先级',
    width: '100px',
    sortable: true,
    isNumeric: true,
    render: (row) => row.priority,
  },
];

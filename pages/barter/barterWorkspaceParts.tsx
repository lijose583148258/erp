import { ArrowRightLeft, Coins, Layers3 } from 'lucide-react';
import type { WorkspaceTaskNavigatorItem } from '../../components/ui/WorkspaceTaskNavigator';
import type { BarterItem } from '../../services/barter.service';
import { MaterialMasterCombobox } from '../../components/materials/MaterialMasterCombobox';

export type OrderOption = { id: string; label: string };
export type BarterDeskTab = 'agreement' | 'batch' | 'ledger';

export const BARTER_DESK_TABS: WorkspaceTaskNavigatorItem<BarterDeskTab>[] = [
  {
    id: 'agreement',
    title: '协议对象',
    subtitle: '新建协议、查找协议、选中协议',
    purpose: '只回答“双方谈好的总标的是什么”。',
    icon: Layers3,
  },
  {
    id: 'batch',
    title: '执行批次',
    subtitle: '按协议分批登记本次交付和本次抵扣',
    purpose: '只回答“这一次实际抵了多少”。',
    icon: ArrowRightLeft,
  },
  {
    id: 'ledger',
    title: '审批过账',
    subtitle: '审核、过账、冲销和批次流水回读',
    purpose: '只回答“哪些批次已经被确认入账”。',
    icon: Coins,
  },
];

export const barterFieldClass =
  'w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-300';

export const createBarterItem = (side: 'our' | 'counterparty'): BarterItem => ({
  side,
  materialId: null,
  itemName: '',
  specification: '',
  unit: side === 'our' ? 'kg' : 'm3',
  quantity: 0,
  unitPrice: 0,
  qualityFactor: 1,
  lossFactor: 1,
  note: '',
});

export const barterStatusLabelMap: Record<string, string> = {
  draft: '草稿',
  active: '执行中',
  partial: '部分完成',
  completed: '已完成',
  closed: '已关闭',
  terminated: '已终止',
  quoted: '待审核',
  approved: '已审核',
  posted: '已过账',
  reversed: '已冲销',
};

export const buildBarterPreview = (items: BarterItem[]) => {
  const getValue = (side: 'our' | 'counterparty') =>
    items
      .filter((item) => item.side === side)
      .reduce(
        (sum, item) =>
          sum +
          Number(item.quantity || 0) *
            Number(item.unitPrice || 0) *
            Number(item.qualityFactor || 1) *
            Number(item.lossFactor || 1),
        0,
      );
  const counterpartyValue = getValue('counterparty');
  const ourValue = getValue('our');
  return {
    counterpartyValue,
    ourValue,
    offsetAmount: Number(Math.min(counterpartyValue, ourValue).toFixed(2)),
    difference: Number((ourValue - counterpartyValue).toFixed(2)),
  };
};

type BarterItemEditorProps = {
  title: string;
  item: BarterItem;
  onChange: (key: keyof BarterItem, value: string | number) => void;
};

export function BarterItemEditor({ title, item, onChange }: BarterItemEditorProps) {
  const label = (name: string) => `${title} ${name}`;

  return (
    <div className="rounded-[24px] border border-slate-100 bg-slate-50/80 p-4">
      <div className="mb-3 text-sm font-black text-slate-800">{title}</div>
      <div className="grid gap-3">
        <MaterialMasterCombobox
          value={item.itemName}
          selectedMaterialId={item.materialId || null}
          onTextChange={(value) => {
            onChange('materialId', 0);
            onChange('itemName', value);
          }}
          onClearSelection={() => onChange('materialId', 0)}
          onSelect={(material) => {
            onChange('materialId', material.id);
            onChange('itemName', material.nameZh);
            onChange('unit', material.baseUnit);
            onChange('specification', material.specification || '');
          }}
        />
        <p className="-mt-1 text-[11px] font-semibold text-slate-500">
          协议草稿可先录名称；审批过账前必须选择已发布的统一物料。
        </p>
        <input aria-label={label('规格')} title={label('规格')} value={item.specification || ''} onChange={(e) => onChange('specification', e.target.value)} placeholder="规格" className={barterFieldClass} />
        <div className="grid grid-cols-3 gap-3">
          <input aria-label={label('数量')} title={label('数量')} type="number" value={item.quantity} onChange={(e) => onChange('quantity', Number(e.target.value || 0))} placeholder="数量" className={barterFieldClass} />
          <input aria-label={label('单位')} title={label('单位')} value={item.unit} onChange={(e) => onChange('unit', e.target.value)} readOnly={Boolean(item.materialId)} placeholder="单位" className={barterFieldClass} />
          <input aria-label={label('单价')} title={label('单价')} type="number" value={item.unitPrice} onChange={(e) => onChange('unitPrice', Number(e.target.value || 0))} placeholder="单价" className={barterFieldClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input aria-label={label('质量系数')} title={label('质量系数')} type="number" step="0.01" value={item.qualityFactor ?? 1} onChange={(e) => onChange('qualityFactor', Number(e.target.value || 1))} placeholder="质量系数" className={barterFieldClass} />
          <input aria-label={label('损耗系数')} title={label('损耗系数')} type="number" step="0.01" value={item.lossFactor ?? 1} onChange={(e) => onChange('lossFactor', Number(e.target.value || 1))} placeholder="损耗系数" className={barterFieldClass} />
        </div>
        <input aria-label={label('行备注/估值证据')} title={label('行备注/估值证据')} value={item.note || ''} onChange={(e) => onChange('note', e.target.value)} placeholder="行备注/估值证据" className={barterFieldClass} />
      </div>
    </div>
  );
}

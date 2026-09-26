import { BarChart3, Building2, MapPin, Package } from 'lucide-react';

type SummaryCard = {
  label: string;
  value: string | number;
  icon: typeof Building2;
  color: string;
  accent: string;
};

type WarehouseWorkspaceSummaryCardsProps = {
  warehouseCount: number;
  totalLocations: number;
  totalItems: number;
  totalQuantity: number;
};

const buildSummaryCards = ({
  warehouseCount,
  totalLocations,
  totalItems,
  totalQuantity,
}: WarehouseWorkspaceSummaryCardsProps): SummaryCard[] => [
  { label: '仓库数量', value: warehouseCount, icon: Building2, color: 'from-amber-500 to-orange-500', accent: 'text-amber-600' },
  { label: '库位总数', value: totalLocations, icon: MapPin, color: 'from-blue-500 to-indigo-500', accent: 'text-blue-600' },
  { label: '库存品项', value: totalItems, icon: Package, color: 'from-emerald-500 to-teal-500', accent: 'text-emerald-600' },
  { label: '库存总量', value: `${totalQuantity.toFixed(1)} kg`, icon: BarChart3, color: 'from-violet-500 to-purple-500', accent: 'text-violet-600' },
];

export const WarehouseWorkspaceSummaryCards = (props: WarehouseWorkspaceSummaryCardsProps) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {buildSummaryCards(props).map(card => (
 <div key={card.label} className="relative bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[24px] p-6 shadow-sm border border-white/40 dark:border-slate-800 overflow-hidden group hover:shadow-lg transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none">
        <div className={`absolute -right-3 -top-3 w-16 h-16 bg-gradient-to-br ${card.color} rounded-[20px] opacity-10 group-hover:opacity-20 transition-opacity rotate-12`} />
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 bg-gradient-to-br ${card.color} rounded-[14px] flex items-center justify-center shadow-lg`}>
            <card.icon size={18} className="text-white" />
          </div>
          <span className="text-xs font-black text-slate-500 uppercase tracking-wider">{card.label}</span>
        </div>
        <p className={`text-2xl font-black ${card.accent} dark:text-white`}>{card.value}</p>
      </div>
    ))}
  </div>
);

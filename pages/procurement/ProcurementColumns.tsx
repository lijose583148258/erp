import React from 'react';
import { Link } from 'lucide-react';
import { StatusBadge, type EnterpriseColumn } from '../../components/ui';
import type { PurchaseOrder, Supplier } from '../../services/procurement.service';

type BuildSupplierColumnsOptions = {
  t: any;
  getSupplierLabel: (supplier?: Pick<Supplier, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'supplierDisplayName'> | null) => string;
};

type BuildPurchaseOrderColumnsOptions = {
  t: any;
  getOrderStatusLabel: (status: PurchaseOrder['status']) => string;
  formatDateOnly: (value?: string) => string;
};

export const buildSupplierColumns = ({
  t,
  getSupplierLabel,
}: BuildSupplierColumnsOptions): EnterpriseColumn<Supplier>[] => [
  {
    key: 'supplier',
    header: t.suppliers,
    sortable: true,
    searchText: (supplier) => [
      supplier.id,
      supplier.name,
      supplier.nameZh,
      supplier.nameEn,
      supplier.nameVi,
      supplier.supplierDisplayName,
      ...(supplier.nameAliases || []),
    ].filter(Boolean).join(' '),
    render: (supplier) => (
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{supplier.id}</p>
        <p className="mt-1 text-base font-black text-slate-900 dark:text-white">
          {getSupplierLabel(supplier) || supplier.supplierDisplayName || supplier.name}
        </p>
        {(supplier.nameZh || supplier.nameEn || supplier.nameVi) ? (
          <p className="mt-1 text-[11px] font-bold text-slate-400">
            {[supplier.nameZh, supplier.nameEn, supplier.nameVi].filter(Boolean).join(' / ')}
          </p>
        ) : null}
      </div>
    ),
  },
  {
    key: 'category',
    header: t.category,
    accessor: 'category',
    sortable: true,
    className: 'font-bold',
  },
  {
    key: 'leadTimeDays',
    header: t.leadTime,
    sortable: true,
    render: (supplier) => (
      <span className="font-data font-black text-slate-700 dark:text-slate-100">
        {supplier.leadTimeDays} {t.days}
      </span>
    ),
  },
  {
    key: 'contact',
    header: t.contact,
    searchText: (supplier) => [
      supplier.contact,
      ...(supplier.contacts || []).flatMap((contact) => [contact.name, contact.phone, contact.email]),
      ...(supplier.addresses || []).flatMap((address) => [address.label, address.city, address.countryCode, address.fullAddress]),
    ].filter(Boolean).join(' '),
    render: (supplier) => {
      const contact = supplier.contacts?.[0];
      const address = supplier.addresses?.[0];
      return (
        <div className="space-y-1 text-xs font-bold text-slate-500 dark:text-slate-300">
          <p>{contact?.name || supplier.contact || t.noContact}</p>
          <p className="text-slate-400">{[contact?.phone, contact?.email].filter(Boolean).join(' / ') || t.noContact}</p>
          {address ? <p className="text-[11px] text-slate-400">{[address.city, address.countryCode, address.fullAddress].filter(Boolean).join(' / ')}</p> : null}
        </div>
      );
    },
  },
  {
    key: 'riskLevel',
    header: t.riskSuppliers,
    sortable: true,
    render: (supplier) => (
      <StatusBadge
        status={supplier.riskLevel}
        label={supplier.riskLevel === 'high' ? t.riskHigh : supplier.riskLevel === 'medium' ? t.riskMedium : t.riskLow}
      />
    ),
  },
];

export const buildPurchaseOrderColumns = ({
  t,
  getOrderStatusLabel,
  formatDateOnly,
}: BuildPurchaseOrderColumnsOptions): EnterpriseColumn<PurchaseOrder>[] => [
  {
    key: 'order',
    header: t.purchaseOrders,
    sortable: true,
    width: '34%',
    searchText: (order) => [
      order.id,
      order.item,
      order.supplierName,
      order.supplierNameZh,
      order.supplierNameEn,
      order.supplierNameVi,
      order.supplierDisplayName,
      order.salesOrderRef,
      order.status,
    ].filter(Boolean).join(' '),
    render: (order) => (
      <div className="min-w-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{order.id}</p>
          {order.isB2B ? <StatusBadge status="processing" label="B2B" /> : null}
        </div>
        <p className="mt-1 text-base font-black text-slate-900 dark:text-white">{order.item}</p>
        {order.salesOrderRef ? (
          <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-indigo-600">
            <Link size={12} />
            <span>{t.linkedSalesOrder}：{order.salesOrderRef}</span>
          </div>
        ) : null}
      </div>
    ),
  },
  {
    key: 'supplier',
    header: t.suppliers,
    sortable: true,
    width: '25%',
    render: (order) => (
      <div className="min-w-[190px] text-xs font-bold text-slate-500 dark:text-slate-300">
        <p className="text-sm font-black text-slate-700 dark:text-slate-100">{order.supplierDisplayName || order.supplierName}</p>
        {(order.supplierNameZh || order.supplierNameEn || order.supplierNameVi) ? (
          <p className="mt-1 text-[11px] text-slate-400">{[order.supplierNameZh, order.supplierNameEn, order.supplierNameVi].filter(Boolean).join(' / ')}</p>
        ) : null}
      </div>
    ),
  },
  {
    key: 'quantity',
    header: t.quantity,
    sortable: true,
    width: '10%',
    render: (order) => (
      <span className="font-data font-black text-slate-700 dark:text-slate-100">
        {order.quantity}{order.unit}
      </span>
    ),
  },
  {
    key: 'price',
    header: t.price,
    sortable: true,
    isNumeric: true,
    width: '14%',
    render: (order) => (
      <div className="text-right">
        <p className="font-data font-black text-slate-700 dark:text-slate-100">
          {order.currency || 'CNY'} {Number(order.price || 0).toLocaleString()}
        </p>
        <p className="mt-1 text-[11px] font-bold text-emerald-600">
          CNY {Number(order.landedUnitCost || order.price || 0).toLocaleString()} / {order.unit}
        </p>
      </div>
    ),
  },
  {
    key: 'eta',
    header: 'ETA',
    searchText: (order) => order.eta,
    render: (order) => formatDateOnly(order.eta),
    sortable: true,
    width: '11%',
    className: 'font-data text-xs',
  },
  {
    key: 'status',
    header: t.status || 'Status',
    sortable: true,
    width: '10%',
    render: (order) => (
      <span data-testid={`purchase-order-status-${order.id}`}>
        <StatusBadge status={order.status} label={getOrderStatusLabel(order.status)} />
      </span>
    ),
  },
];

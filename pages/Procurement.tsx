import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Factory, ClipboardList, Truck, AlertTriangle, Plus, ArrowRightLeft, Link, CheckCircle } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { EnterpriseDataGrid, FormField, PageShell, StatusBadge, type EnterpriseColumn } from '../components/ui';
import { procurementService, PurchaseOrder, PurchaseReceiptBundle, Supplier } from '../services/procurement.service';
import { orderService } from '../services/order.service';
import { CustomerAddress, SalesOrder } from '../types';
import { matchesScopedSearch, splitSearchTerms } from '../utils/scopedSearch';

const splitAliases = (value: string) =>
  value
    .split(/[\n,;\uFF0C\u3001]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const upsertById = <T extends { id: string }>(item: T, list: T[]) => [
  item,
  ...list.filter((current) => String(current.id) !== String(item.id)),
];

const parseNumericInput = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const mergePreservingLocalWrites = <T extends { id: string }>(localFirst: T[], serverList: T[]) => {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...localFirst, ...serverList]) {
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
};

const Procurement = () => {
  const { t, notify, language, currentUser } = useAppContext();
  const [activeTab, setActiveTab] = useState<'suppliers' | 'orders'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [newSupplier, setNewSupplier] = useState({
    name: '',
    nameZh: '',
    nameEn: '',
    nameVi: '',
    nameAliases: '',
    category: '',
    rating: '4',
    leadTimeDays: '7',
    riskLevel: 'medium',
    contact: '',
    contactPhone: '',
    contactEmail: '',
    addressLabel: '',
    addressCountryCode: '',
    addressCity: '',
    addressFullAddress: '',
  });
  const [newOrder, setNewOrder] = useState({
    supplierId: '',
    item: '',
    quantity: '10',
    unit: '件',
    price: '7200',
    currency: 'CNY',
    exchangeRate: '1',
    taxRate: '0',
    taxAmount: '',
    freightCost: '0',
    dutyCost: '0',
    insuranceCost: '0',
    otherCost: '0',
    eta: '',
    salesOrderRef: '',
  });
  const [isB2B, setIsB2B] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [b2bLinks, setB2bLinks] = useState<Record<string, { linked: boolean; purchaseOrder?: PurchaseOrder }>>({});
  const [receiptDrawerOrder, setReceiptDrawerOrder] = useState<PurchaseOrder | null>(null);
  const [receiptBundle, setReceiptBundle] = useState<PurchaseReceiptBundle | null>(null);
  const [isReceiptLoading, setIsReceiptLoading] = useState(false);
  const [receiptForm, setReceiptForm] = useState({
    quantity: '',
    acceptedQuantity: '',
    rejectedQuantity: '0',
    batchNo: '',
    discrepancyReason: '',
    note: '',
  });
  const localWriteVersionRef = useRef(0);

  const loadData = useCallback(async () => {
    const loadStartedAtVersion = localWriteVersionRef.current;
    try {
      setIsLoading(true);
      const [suppliersData, salesData] = await Promise.all([
        procurementService.getAllSuppliers(),
        orderService.getAll(),
      ]);
      const canReadPurchaseOrders = ['admin', 'manager', 'warehouse', 'finance'].includes(currentUser.role);
      const ordersData = canReadPurchaseOrders ? await procurementService.getAllOrders() : [];

      const hasLocalWriteDuringLoad = localWriteVersionRef.current !== loadStartedAtVersion;
      setSuppliers(prev => hasLocalWriteDuringLoad ? mergePreservingLocalWrites(prev, suppliersData) : suppliersData);
      setOrders(prev => hasLocalWriteDuringLoad ? mergePreservingLocalWrites(prev, ordersData) : ordersData);
      setSalesOrders(salesData);
    } catch {
      notify('error', t.loadDataFail || 'Failed to load procurement data');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser.role, notify, t.loadDataFail]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isB2B || !newOrder.salesOrderRef || b2bLinks[newOrder.salesOrderRef]) return;
    let active = true;
    procurementService.getB2BStatus(newOrder.salesOrderRef).then((status) => {
      if (!active) return;
      setB2bLinks(prev => ({ ...prev, [newOrder.salesOrderRef]: status }));
    }).catch(() => {
      if (!active) return;
      setB2bLinks(prev => ({ ...prev, [newOrder.salesOrderRef]: { linked: false } }));
    });
    return () => {
      active = false;
    };
  }, [b2bLinks, isB2B, newOrder.salesOrderRef]);

  const stats = useMemo(() => {
    const avgLead = suppliers.length
      ? Math.round(suppliers.reduce((sum, supplier) => sum + supplier.leadTimeDays, 0) / suppliers.length)
      : 0;
    const risky = suppliers.filter(supplier => supplier.riskLevel === 'high').length;
    const activeOrders = orders.filter(order => order.status !== 'received').length;
    return { avgLead, risky, activeOrders };
  }, [orders, suppliers]);

  const purchaseCostPreview = useMemo(() => {
    const quantity = parseNumericInput(newOrder.quantity);
    const price = parseNumericInput(newOrder.price);
    const exchangeRate = Math.max(parseNumericInput(newOrder.exchangeRate, 1), 0.000001);
    const taxRate = Math.max(parseNumericInput(newOrder.taxRate), 0);
    const itemAmount = quantity * price;
    const baseItemAmount = newOrder.currency === 'CNY' ? itemAmount : itemAmount / exchangeRate;
    const explicitTaxAmount = newOrder.taxAmount.trim() ? parseNumericInput(newOrder.taxAmount) : null;
    const taxAmount = explicitTaxAmount === null ? baseItemAmount * (taxRate / 100) : explicitTaxAmount;
    const landedCostAmount = roundMoney(
      baseItemAmount
      + taxAmount
      + parseNumericInput(newOrder.freightCost)
      + parseNumericInput(newOrder.dutyCost)
      + parseNumericInput(newOrder.insuranceCost)
      + parseNumericInput(newOrder.otherCost),
    );
    return {
      landedCostAmount,
      landedUnitCost: quantity > 0 ? roundMoney(landedCostAmount / quantity) : 0,
    };
  }, [newOrder]);

  const filteredSuppliers = useMemo(() => {
    const terms = splitSearchTerms(supplierSearch);
    if (terms.length === 0) return suppliers;

    return suppliers.filter((supplier) => {
      return matchesScopedSearch([
        supplier.id,
        supplier.name,
        supplier.nameZh,
        supplier.nameEn,
        supplier.nameVi,
        supplier.supplierDisplayName,
        ...(supplier.nameAliases || []),
        supplier.category,
        supplier.contact,
        ...(supplier.contacts || []).flatMap((contact) => [
          contact.name,
          contact.role,
          contact.position,
          contact.phone,
          contact.email,
          contact.mobile,
          contact.department,
          contact.whatsapp,
          contact.wechat,
        ]),
        ...(supplier.addresses || []).flatMap((address) => [
          address.label,
          address.fullAddress,
          address.city,
          address.region,
          address.countryCode,
          address.registeredName,
          address.registrationNo,
          address.taxNo,
        ]),
      ], supplierSearch);
    });
  }, [supplierSearch, suppliers]);

  const getSupplierLabel = (supplier?: Pick<Supplier, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'supplierDisplayName'> | null) => {
    if (!supplier) return '';
    if (language === 'en') {
      return supplier.nameEn || supplier.name || supplier.nameZh || supplier.nameVi || supplier.supplierDisplayName || '';
    }
    if (language === 'vi') {
      return supplier.nameVi || supplier.nameEn || supplier.nameZh || supplier.name || supplier.supplierDisplayName || '';
    }
    return supplier.nameZh || supplier.name || supplier.nameEn || supplier.nameVi || supplier.supplierDisplayName || '';
  };

  const getOrderStatusLabel = (status: PurchaseOrder['status']) => {
    switch (status) {
      case 'pending':
        return t.pending;
      case 'approved':
        return t.approved;
      case 'in_transit':
        return t.activeTransit || t.transit || status;
      case 'received':
        return language === 'en' ? 'Received' : language === 'vi' ? 'Đã nhận hàng' : '已收货';
      case 'cancelled':
        return t.contractCancelled || status;
      default:
        return status;
    }
  };

  const formatDateOnly = (value?: string) => {
    if (!value) return '-';
    const [datePart] = String(value).split('T');
    return datePart || value;
  };

  const supplierColumns: EnterpriseColumn<Supplier>[] = [
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

  const updatePurchaseStatus = async (order: PurchaseOrder, status: PurchaseOrder['status']) => {
    try {
      const updatedOrder = await procurementService.updateOrderStatus(order.id, status);
      setOrders(prev => prev.map(item => item.id === order.id ? updatedOrder : item));
      if (status === 'approved') notify('success', t.paymentVerified || 'PO approved');
      if (status === 'in_transit') notify('success', t.activeTransit || 'PO dispatched');
      if (status === 'received') notify('success', `${getOrderStatusLabel(status)} / ${language === 'en' ? 'stock received' : language === 'vi' ? 'đã nhập kho' : '已入库'}`);
    } catch {
      notify('error', t.connectionFailed || 'Purchase status update failed');
    }
  };

  const resetReceiptForm = (order?: PurchaseOrder | null, bundle?: PurchaseReceiptBundle | null) => {
    const remaining = bundle?.receiptSummary.remainingQuantity ?? order?.quantity ?? 0;
    const nextQuantity = remaining > 0 ? String(remaining) : '';
    setReceiptForm({
      quantity: nextQuantity,
      acceptedQuantity: nextQuantity,
      rejectedQuantity: '0',
      batchNo: order ? `${order.item}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}` : '',
      discrepancyReason: '',
      note: '',
    });
  };

  const openReceiptDrawer = async (order: PurchaseOrder) => {
    try {
      setReceiptDrawerOrder(order);
      setIsReceiptLoading(true);
      const bundle = await procurementService.getOrderReceipts(order.id);
      setReceiptBundle(bundle);
      resetReceiptForm(order, bundle);
    } catch {
      notify('error', t.connectionFailed || '收货批次读取失败');
    } finally {
      setIsReceiptLoading(false);
    }
  };

  const submitReceipt = async () => {
    if (!receiptDrawerOrder) return;
    const quantity = Number(receiptForm.quantity);
    const acceptedQuantity = Number(receiptForm.acceptedQuantity || 0);
    const rejectedQuantity = Number(receiptForm.rejectedQuantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity - acceptedQuantity - rejectedQuantity) > 0.000001) {
      notify('error', '本次收货必须等于合格数量与差异数量之和');
      return;
    }

    try {
      setIsReceiptLoading(true);
      const bundle = await procurementService.createReceipt(receiptDrawerOrder.id, {
        quantity,
        acceptedQuantity,
        rejectedQuantity,
        batchNo: receiptForm.batchNo || undefined,
        discrepancyReason: receiptForm.discrepancyReason || undefined,
        note: receiptForm.note || undefined,
      });
      setReceiptBundle(bundle);
      setReceiptDrawerOrder(bundle.purchaseOrder);
      setOrders(prev => prev.map(item => item.id === bundle.purchaseOrder.id ? bundle.purchaseOrder : item));
      resetReceiptForm(bundle.purchaseOrder, bundle);
      notify('success', '收货批次已入账');
    } catch {
      notify('error', t.saveFail || '收货批次保存失败');
    } finally {
      setIsReceiptLoading(false);
    }
  };

  const purchaseOrderColumns: EnterpriseColumn<PurchaseOrder>[] = [
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

  const renderPurchaseOrderActions = (order: PurchaseOrder) => (
    <div className="flex justify-end gap-2">
      {order.status === 'pending' && (
        <button
          data-testid={`purchase-order-approve-${order.id}`}
          type="button"
          onClick={() => updatePurchaseStatus(order, 'approved')}
          className="rounded-full bg-emerald-100 p-2 text-emerald-700 transition-colors hover:bg-emerald-200"
          title={t.approve}
        >
          <CheckCircle size={14} />
        </button>
      )}
      {order.status === 'approved' && (
        <button
          data-testid={`purchase-order-dispatch-${order.id}`}
          type="button"
          onClick={() => updatePurchaseStatus(order, 'in_transit')}
          className="rounded-full bg-blue-100 p-2 text-blue-700 transition-colors hover:bg-blue-200"
          title={t.dispatch}
        >
          <Truck size={14} />
        </button>
      )}
      {['approved', 'in_transit', 'received'].includes(order.status) && (
        <button
          data-testid={`purchase-order-receipts-${order.id}`}
          type="button"
          onClick={() => openReceiptDrawer(order)}
          className="rounded-full bg-emerald-100 p-2 text-emerald-700 transition-colors hover:bg-emerald-200"
          title={language === 'en' ? 'Receipt batches' : language === 'vi' ? 'Lô nhận hàng' : '收货批次'}
        >
          <ClipboardList size={14} />
        </button>
      )}
    </div>
  );

  const addSupplier = async () => {
    if (!newSupplier.name || !newSupplier.category) return;

    const contacts = [
      {
        name: newSupplier.contact || '',
        position: '',
        phone: newSupplier.contactPhone || '',
        email: newSupplier.contactEmail || '',
        isPrimary: true,
        role: '',
        department: '',
        language: 'zh' as const,
      },
    ].filter((contact) => contact.name || contact.phone || contact.email);

    const addresses: CustomerAddress[] = [
      {
        type: 'legal' as const,
        label: newSupplier.addressLabel || t.legalEntityAddress,
        fullAddress: newSupplier.addressFullAddress || '',
        countryCode: newSupplier.addressCountryCode || '',
        city: newSupplier.addressCity || '',
        isPrimary: true,
      },
    ].filter((address) => address.fullAddress || address.city || address.countryCode);

    try {
      const createdSupplier = await procurementService.createSupplier({
        name: newSupplier.name,
        nameZh: newSupplier.nameZh || undefined,
        nameEn: newSupplier.nameEn || undefined,
        nameVi: newSupplier.nameVi || undefined,
        nameAliases: splitAliases(newSupplier.nameAliases),
        contacts,
        addresses,
        category: newSupplier.category,
        rating: Number(newSupplier.rating),
        leadTimeDays: Number(newSupplier.leadTimeDays),
        riskLevel: newSupplier.riskLevel as Supplier['riskLevel'],
        contact: newSupplier.contact || newSupplier.contactPhone || newSupplier.contactEmail || '',
        status: 'active',
      });

      localWriteVersionRef.current += 1;
      setSuppliers(prev => upsertById(createdSupplier, prev));
      setNewSupplier({
        name: '',
        nameZh: '',
        nameEn: '',
        nameVi: '',
        nameAliases: '',
        category: '',
        rating: '4',
        leadTimeDays: '7',
        riskLevel: 'medium',
        contact: '',
        contactPhone: '',
        contactEmail: '',
        addressLabel: '',
        addressCountryCode: '',
        addressCity: '',
        addressFullAddress: '',
      });
        notify('success', t.supplierCreated);
    } catch {
      notify('error', t.supplierCreateFail);
    }
  };

  const addOrder = async () => {
    const supplier = suppliers.find(item => item.id === newOrder.supplierId);
    if (!supplier || !newOrder.item) return;
    const linkedSalesOrder = isB2B && newOrder.salesOrderRef
      ? salesOrders.find(so => so.id === newOrder.salesOrderRef || (so as any).orderNo === newOrder.salesOrderRef)
      : null;

    try {
      const createdOrder = await procurementService.createOrder({
        supplierId: supplier.id,
        supplierName: getSupplierLabel(supplier) || supplier.supplierDisplayName || supplier.name,
        supplierNameZh: supplier.nameZh,
        supplierNameEn: supplier.nameEn,
        supplierNameVi: supplier.nameVi,
        item: newOrder.item,
        quantity: Number(newOrder.quantity),
        unit: newOrder.unit,
        price: Number(newOrder.price),
        currency: newOrder.currency,
        exchangeRate: Number(newOrder.exchangeRate || 1),
        taxRate: Number(newOrder.taxRate || 0),
        taxAmount: newOrder.taxAmount === '' ? undefined : Number(newOrder.taxAmount),
        freightCost: Number(newOrder.freightCost || 0),
        dutyCost: Number(newOrder.dutyCost || 0),
        insuranceCost: Number(newOrder.insuranceCost || 0),
        otherCost: Number(newOrder.otherCost || 0),
        eta: newOrder.eta || new Date().toISOString().split('T')[0],
        status: 'pending',
        salesOrderRef: linkedSalesOrder ? ((linkedSalesOrder as any).orderNo || linkedSalesOrder.id) : newOrder.salesOrderRef,
        salesOrderId: linkedSalesOrder ? linkedSalesOrder.id : undefined,
        isB2B,
      });

      localWriteVersionRef.current += 1;
      setOrders(prev => upsertById(createdOrder, prev));
      setNewOrder({
        supplierId: '',
        item: '',
        quantity: '10',
        unit: '件',
        price: '7200',
        currency: 'CNY',
        exchangeRate: '1',
        taxRate: '0',
        taxAmount: '',
        freightCost: '0',
        dutyCost: '0',
        insuranceCost: '0',
        otherCost: '0',
        eta: '',
        salesOrderRef: '',
      });
        notify('success', t.purchaseCreated);

      if (isB2B && newOrder.salesOrderRef) {
        const salesOrder = linkedSalesOrder;
        if (salesOrder) {
          if (createdOrder.salesOrderId) {
            setB2bLinks(prev => ({
              ...prev,
              [salesOrder.id]: { linked: true, purchaseOrder: createdOrder },
            }));
            notify('success', t.b2bLinked);
            return;
          }
          const linkResult = await procurementService.linkB2BOrder(createdOrder.id, salesOrder.id);
          if (linkResult.success) {
            setB2bLinks(prev => ({
              ...prev,
              [salesOrder.id]: { linked: true, purchaseOrder: linkResult.purchaseOrder || createdOrder },
            }));
            notify('success', t.b2bLinked);
          } else {
            notify('warning', t.b2bLinkIncomplete);
          }
        }
      }
    } catch {
      notify('error', t.purchaseCreateFail);
    }
  };

  return (
    <PageShell
      title={t.procurement}
      subtitle={t.procurementSubtitle}
      tabs={[
        {
          id: 'suppliers',
          label: t.suppliers,
          active: activeTab === 'suppliers',
          onClick: () => setActiveTab('suppliers'),
          testId: 'procurement-tab-suppliers',
        },
        {
          id: 'orders',
          label: t.purchaseOrders,
          active: activeTab === 'orders',
          onClick: () => setActiveTab('orders'),
          testId: 'procurement-tab-orders',
        },
      ]}
    >

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.supplierTotal}</p>
          <div className="flex items-center justify-between">
            <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{suppliers.length}</span>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-blue-500"><Factory size={20} /></div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.activePurchase}</p>
          <div className="flex items-center justify-between">
            <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{stats.activeOrders}</span>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-emerald-500"><ClipboardList size={20} /></div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.avgLead}</p>
          <div className="flex items-center justify-between">
            <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{stats.avgLead}</span>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-amber-500"><Truck size={20} /></div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.riskSuppliers}</p>
          <div className="flex items-center justify-between">
            <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{stats.risky}</span>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-rose-500"><AlertTriangle size={20} /></div>
          </div>
        </div>
      </div>

      {activeTab === 'suppliers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 app-card p-6">
            <EnterpriseDataGrid
              data={filteredSuppliers}
              columns={supplierColumns}
              rowKey="id"
              title={t.suppliers}
              description={t.supplierAliasPlaceholder}
              searchValue={supplierSearch}
              onSearchChange={setSupplierSearch}
              searchPlaceholder={t.search}
              searchInputTestId="procurement-supplier-search"
              manualSearch
              loading={isLoading}
              emptyTitle={t.noData || '暂无供应商'}
              emptyDescription={t.search || '请调整搜索条件，或在右侧新增供应商。'}
              getRowTestId={(supplier) => `supplier-card-${supplier.id}`}
              defaultPageSize={8}
            />
          </div>

          <div className="lg:col-span-4 app-card flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden p-0 lg:sticky lg:top-6">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 dark:border-slate-800">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t.addSupplier}</h3>
              <Plus size={16} className="text-slate-400" />
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 pr-4">
              <FormField dataTestId="supplier-name-input" label={t.supplierName} value={newSupplier.name} onChange={(value) => setNewSupplier(prev => ({ ...prev, name: value }))} placeholder={t.supplierName} required />
              <FormField label={`${t.supplierName}（中文）`} value={newSupplier.nameZh} onChange={(value) => setNewSupplier(prev => ({ ...prev, nameZh: value }))} placeholder={`${t.supplierName}（中文）`} />
              <FormField label={`${t.supplierName} (English)`} value={newSupplier.nameEn} onChange={(value) => setNewSupplier(prev => ({ ...prev, nameEn: value }))} placeholder={`${t.supplierName} (English)`} />
              <FormField label={`${t.supplierName} (Tiếng Việt)`} value={newSupplier.nameVi} onChange={(value) => setNewSupplier(prev => ({ ...prev, nameVi: value }))} placeholder={`${t.supplierName} (Tiếng Việt)`} />
              <FormField as="textarea" value={newSupplier.nameAliases} onChange={(value) => setNewSupplier(prev => ({ ...prev, nameAliases: value }))} placeholder={t.supplierAliasPlaceholder} rows={3} />
              <FormField dataTestId="supplier-category-input" label={t.category} value={newSupplier.category} onChange={(value) => setNewSupplier(prev => ({ ...prev, category: value }))} placeholder={t.category} required />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="mb-3 text-xs font-bold text-slate-400">{t.mainContact}</div>
                <div className="space-y-3">
                  <FormField dataTestId="supplier-contact-input" value={newSupplier.contact} onChange={(value) => setNewSupplier(prev => ({ ...prev, contact: value }))} placeholder={t.contactName} inputClassName="bg-white dark:bg-slate-900" />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField dataTestId="supplier-phone-input" value={newSupplier.contactPhone} onChange={(value) => setNewSupplier(prev => ({ ...prev, contactPhone: value }))} placeholder={t.phone} inputClassName="bg-white dark:bg-slate-900" />
                    <FormField dataTestId="supplier-email-input" value={newSupplier.contactEmail} onChange={(value) => setNewSupplier(prev => ({ ...prev, contactEmail: value }))} placeholder={t.email} inputClassName="bg-white dark:bg-slate-900" />
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="mb-3 text-xs font-bold text-slate-400">{t.mainAddress}</div>
                <div className="space-y-3">
                  <FormField dataTestId="supplier-address-label-input" value={newSupplier.addressLabel} onChange={(value) => setNewSupplier(prev => ({ ...prev, addressLabel: value }))} placeholder={t.addressLabel} inputClassName="bg-white dark:bg-slate-900" />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField dataTestId="supplier-country-code-input" value={newSupplier.addressCountryCode} onChange={(value) => setNewSupplier(prev => ({ ...prev, addressCountryCode: value }))} transformValue={(value) => value.toUpperCase()} placeholder={t.countryCode} inputClassName="bg-white uppercase dark:bg-slate-900" />
                    <FormField dataTestId="supplier-city-input" value={newSupplier.addressCity} onChange={(value) => setNewSupplier(prev => ({ ...prev, addressCity: value }))} placeholder={t.city} inputClassName="bg-white dark:bg-slate-900" />
                  </div>
                  <FormField dataTestId="supplier-full-address-input" as="textarea" value={newSupplier.addressFullAddress} onChange={(value) => setNewSupplier(prev => ({ ...prev, addressFullAddress: value }))} placeholder={t.fullAddress} rows={3} inputClassName="bg-white dark:bg-slate-900" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField value={newSupplier.rating} onChange={(value) => setNewSupplier(prev => ({ ...prev, rating: value }))} placeholder={t.rating} />
                <FormField value={newSupplier.leadTimeDays} onChange={(value) => setNewSupplier(prev => ({ ...prev, leadTimeDays: value }))} placeholder={t.leadTime} />
              </div>
              <FormField
                as="select"
                value={newSupplier.riskLevel}
                onChange={(value) => setNewSupplier(prev => ({ ...prev, riskLevel: value }))}
                options={[
                  { value: 'low', label: t.riskLow },
                  { value: 'medium', label: t.riskMedium },
                  { value: 'high', label: t.riskHigh },
                ]}
              />
            </div>
            <div className="border-t border-slate-100 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
              <button data-testid="save-supplier-button" onClick={addSupplier} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-appLift transition hover:bg-blue-700">{t.saveSupplier}</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 app-card p-6">
            <EnterpriseDataGrid
              data={orders}
              columns={purchaseOrderColumns}
              rowKey="id"
              title={t.purchaseOrders}
              description={t.backToBack}
              searchValue={purchaseSearch}
              onSearchChange={setPurchaseSearch}
              searchPlaceholder={t.search}
              loading={isLoading}
              emptyTitle={t.noData || '暂无采购订单'}
              emptyDescription={t.selectSupplier || '请在右侧选择供应商并新增采购单。'}
              getRowTestId={(order) => `purchase-order-card-${order.id}`}
              rowActions={renderPurchaseOrderActions}
              defaultPageSize={8}
            />
          </div>

          <div className="lg:col-span-4 app-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t.addPurchase}</h3>
              <Plus size={16} className="text-slate-400" />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800">
                <div className="flex items-center">
                  <ArrowRightLeft size={16} className="text-indigo-600 mr-2" />
                  <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">{t.backToBack}</span>
                </div>
                <button
                  data-testid="b2b-toggle"
                  onClick={() => setIsB2B(!isB2B)}
                  className={`w-10 h-5 rounded-full transition-all relative ${isB2B ? 'bg-indigo-600' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isB2B ? 'left-6' : 'left-1'}`} />
                </button>
              </div>

              {isB2B && (
                <div className="space-y-2">
                  <select
                    data-testid="linked-sales-order-select"
                    value={newOrder.salesOrderRef}
                    onChange={e => setNewOrder(prev => ({ ...prev, salesOrderRef: e.target.value }))}
                    className="app-control w-full bg-indigo-50/50 text-xs font-bold dark:bg-indigo-900/10"
                  >
                    <option value="">{t.selectLinkedSalesOrder}</option>
                    {salesOrders.filter(so => so.status !== 'cancelled').map(so => {
                      const salesOrderNo = (so as any).orderNo || so.id;
                      return (
                        <option key={so.id} value={so.id}>
                          {salesOrderNo} - {so.customerDisplayName || so.customerName || so.customerNameZh || ''} ({so.items?.length || 0}{t.itemsUnit})
                        </option>
                      );
                    })}
                  </select>
                  {newOrder.salesOrderRef && b2bLinks[newOrder.salesOrderRef] && (
                    <div className={`p-2 rounded-lg text-[11px] font-bold flex items-center gap-1 ${b2bLinks[newOrder.salesOrderRef].linked ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {b2bLinks[newOrder.salesOrderRef].linked ? (
                        <><CheckCircle size={10} />{t.purchaseAlreadyLinked}</>
                      ) : (
                        <><Link size={10} />{t.purchaseNotLinked}</>
                      )}
                    </div>
                  )}
                </div>
              )}

              <FormField
                dataTestId="purchase-supplier-select"
                as="select"
                value={newOrder.supplierId}
                onChange={(value) => setNewOrder(prev => ({ ...prev, supplierId: value }))}
                options={[
                  { value: '', label: t.selectSupplier },
                  ...suppliers.map(supplier => ({ value: supplier.id, label: getSupplierLabel(supplier) || supplier.name })),
                ]}
                required
              />
              <FormField dataTestId="purchase-item-input" value={newOrder.item} onChange={(value) => setNewOrder(prev => ({ ...prev, item: value }))} placeholder={t.productName} required />
              <div className="grid grid-cols-3 gap-3">
                <FormField dataTestId="purchase-quantity-input" value={newOrder.quantity} onChange={(value) => setNewOrder(prev => ({ ...prev, quantity: value }))} placeholder={t.quantity} />
                <FormField value={newOrder.unit} onChange={(value) => setNewOrder(prev => ({ ...prev, unit: value }))} placeholder={t.unit} />
                <FormField dataTestId="purchase-price-input" value={newOrder.price} onChange={(value) => setNewOrder(prev => ({ ...prev, price: value }))} placeholder={t.price} />
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/20">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">到岸成本</p>
                  <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    CNY {purchaseCostPreview.landedUnitCost.toLocaleString()} / {newOrder.unit || t.unit}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    dataTestId="purchase-currency-select"
                    as="select"
                    value={newOrder.currency}
                    onChange={(value) => setNewOrder(prev => ({ ...prev, currency: value, exchangeRate: value === 'CNY' ? '1' : prev.exchangeRate }))}
                    options={[
                      { value: 'CNY', label: 'CNY' },
                      { value: 'USD', label: 'USD' },
                      { value: 'VND', label: 'VND' },
                    ]}
                    inputClassName="bg-white dark:bg-slate-900"
                  />
                  <FormField
                    dataTestId="purchase-exchange-rate-input"
                    label="汇率"
                    value={newOrder.exchangeRate}
                    onChange={(value) => setNewOrder(prev => ({ ...prev, exchangeRate: value }))}
                    placeholder="1 CNY = X"
                    inputClassName="bg-white dark:bg-slate-900"
                  />
                  <FormField
                    dataTestId="purchase-tax-rate-input"
                    label="税率%"
                    value={newOrder.taxRate}
                    onChange={(value) => setNewOrder(prev => ({ ...prev, taxRate: value }))}
                    inputClassName="bg-white dark:bg-slate-900"
                  />
                  <FormField
                    dataTestId="purchase-tax-amount-input"
                    label="税额"
                    value={newOrder.taxAmount}
                    onChange={(value) => setNewOrder(prev => ({ ...prev, taxAmount: value }))}
                    placeholder="留空自动按税率"
                    inputClassName="bg-white dark:bg-slate-900"
                  />
                  <FormField dataTestId="purchase-freight-cost-input" label="运费(CNY)" value={newOrder.freightCost} onChange={(value) => setNewOrder(prev => ({ ...prev, freightCost: value }))} inputClassName="bg-white dark:bg-slate-900" />
                  <FormField dataTestId="purchase-duty-cost-input" label="关税(CNY)" value={newOrder.dutyCost} onChange={(value) => setNewOrder(prev => ({ ...prev, dutyCost: value }))} inputClassName="bg-white dark:bg-slate-900" />
                  <FormField dataTestId="purchase-insurance-cost-input" label="保险(CNY)" value={newOrder.insuranceCost} onChange={(value) => setNewOrder(prev => ({ ...prev, insuranceCost: value }))} inputClassName="bg-white dark:bg-slate-900" />
                  <FormField dataTestId="purchase-other-cost-input" label="其他(CNY)" value={newOrder.otherCost} onChange={(value) => setNewOrder(prev => ({ ...prev, otherCost: value }))} inputClassName="bg-white dark:bg-slate-900" />
                </div>
                <p className="mt-3 text-[11px] font-bold text-emerald-700/80 dark:text-emerald-300/80">
                  预估总到岸成本：CNY {purchaseCostPreview.landedCostAmount.toLocaleString()}
                </p>
              </div>
              <FormField dataTestId="purchase-eta-input" type="date" value={newOrder.eta} onChange={(value) => setNewOrder(prev => ({ ...prev, eta: value }))} />
              <button data-testid="save-purchase-button" onClick={addOrder} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-appLift transition hover:bg-blue-700">{t.savePurchase}</button>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-xs text-slate-400 font-bold">{t.loading || '加载中…'}</div>
      )}

      {receiptDrawerOrder && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm" data-testid="purchase-receipt-drawer">
          <button
            type="button"
            aria-label="关闭收货批次"
            className="flex-1 cursor-default"
            onClick={() => setReceiptDrawerOrder(null)}
          />
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">Receipt Ledger</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">收货批次</h3>
                <p className="mt-1 text-sm font-bold text-slate-500">{receiptDrawerOrder.item} · #{receiptDrawerOrder.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setReceiptDrawerOrder(null)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
              >
                关闭
              </button>
            </div>

            <div className="mt-6 grid grid-cols-4 gap-3">
              {[
                ['订单量', receiptBundle?.receiptSummary.orderedQuantity ?? receiptDrawerOrder.quantity],
                ['已处理', receiptBundle?.receiptSummary.processedQuantity ?? 0],
                ['合格', receiptBundle?.receiptSummary.acceptedQuantity ?? 0],
                ['剩余', receiptBundle?.receiptSummary.remainingQuantity ?? receiptDrawerOrder.quantity],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="mt-2 font-data text-xl font-black text-slate-900 dark:text-white">{String(value)}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">新增收货批次</h4>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">
                  {receiptDrawerOrder.status === 'received' ? '已收满' : '可继续收货'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FormField dataTestId="purchase-receipt-quantity-input" label="本次数量" value={receiptForm.quantity} onChange={(value) => setReceiptForm(prev => ({ ...prev, quantity: value, acceptedQuantity: prev.acceptedQuantity || value }))} disabled={receiptDrawerOrder.status === 'received'} />
                <FormField dataTestId="purchase-receipt-accepted-input" label="合格数量" value={receiptForm.acceptedQuantity} onChange={(value) => setReceiptForm(prev => ({ ...prev, acceptedQuantity: value }))} disabled={receiptDrawerOrder.status === 'received'} />
                <FormField dataTestId="purchase-receipt-rejected-input" label="差异数量" value={receiptForm.rejectedQuantity} onChange={(value) => setReceiptForm(prev => ({ ...prev, rejectedQuantity: value }))} disabled={receiptDrawerOrder.status === 'received'} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <FormField dataTestId="purchase-receipt-batch-input" label="入库批次" value={receiptForm.batchNo} onChange={(value) => setReceiptForm(prev => ({ ...prev, batchNo: value }))} disabled={receiptDrawerOrder.status === 'received'} />
                <FormField label="差异原因" value={receiptForm.discrepancyReason} onChange={(value) => setReceiptForm(prev => ({ ...prev, discrepancyReason: value }))} disabled={receiptDrawerOrder.status === 'received'} />
              </div>
              <FormField className="mt-3" as="textarea" rows={3} label="备注" value={receiptForm.note} onChange={(value) => setReceiptForm(prev => ({ ...prev, note: value }))} disabled={receiptDrawerOrder.status === 'received'} />
              <button
                type="button"
                data-testid="purchase-receipt-save-button"
                onClick={submitReceipt}
                disabled={isReceiptLoading || receiptDrawerOrder.status === 'received'}
                className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-appLift transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isReceiptLoading ? '保存中...' : '保存收货批次'}
              </button>
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">历史批次</h4>
              {(receiptBundle?.receipts || []).length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-200 p-6 text-center text-xs font-bold text-slate-400 dark:border-slate-800">
                  暂无收货批次
                </div>
              ) : (
                receiptBundle?.receipts.map((receipt) => (
                  <div key={receipt.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black text-slate-700 dark:text-slate-100">{receipt.receiptNo}</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-400">{receipt.batchNo || '-'} · {receipt.receivedAt || receipt.createdAt || '-'}</p>
                      </div>
                      <StatusBadge status={receipt.rejectedQuantity > 0 ? 'exception' : 'received'} label={receipt.rejectedQuantity > 0 ? '有差异' : '正常'} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-slate-500">
                      <span>本次 {receipt.quantity}{receipt.unit}</span>
                      <span>合格 {receipt.acceptedQuantity}{receipt.unit}</span>
                      <span>差异 {receipt.rejectedQuantity}{receipt.unit}</span>
                    </div>
                    {receipt.note || receipt.discrepancyReason ? (
                      <p className="mt-2 text-xs font-medium text-slate-400">{receipt.discrepancyReason || receipt.note}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}
    </PageShell>
  );
};

export default Procurement;


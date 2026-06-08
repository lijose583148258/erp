import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, ClipboardList, Truck } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { can } from '../app/permissions';
import { getModuleDescription, getModuleTitle } from '../components/navigation/moduleRegistry';
import { DocumentInputGuide } from '../components/ui/DocumentInputGuide';
import { PageShell } from '../components/ui';
import { procurementService, PurchaseOrder, PurchaseReceiptBundle, Supplier } from '../services/procurement.service';
import { orderService } from '../services/order.service';
import { CustomerAddress, SalesOrder } from '../types';
import { matchesScopedSearch, splitSearchTerms } from '../utils/scopedSearch';
import { buildPurchaseOrderColumns, buildSupplierColumns } from './procurement/ProcurementColumns';
import { ProcurementDeskNavigator, type ProcurementDeskTab } from './procurement/ProcurementDeskNavigator';
import { ProcurementStats } from './procurement/ProcurementStats';
import { PurchaseOrderWorkspace } from './procurement/PurchaseOrderWorkspace';
import { PurchaseReceiptDrawer } from './procurement/PurchaseReceiptDrawer';
import { SupplierWorkspace } from './procurement/SupplierWorkspace';
import {
  calculatePurchaseCostPreview,
  createEmptyPurchaseOrderForm,
  createEmptyReceiptForm,
  createEmptySupplierForm,
  createReceiptFormForOrder,
  mergePreservingLocalWrites,
  splitAliases,
  upsertById,
  validatePurchaseOrderForm,
  validatePurchaseReceiptForm,
  validateSupplierForm,
  type ProcurementFormErrors,
} from './procurement/procurementForms';

const Procurement = () => {
  const { t, notify, language, currentUser } = useAppContext();
  const canReadProcurement = can(currentUser, 'procurement.read') || can(currentUser, 'procurement.write');
  const canWriteProcurement = can(currentUser, 'procurement.write');
  const [activeDesk, setActiveDesk] = useState<ProcurementDeskTab>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [newSupplier, setNewSupplier] = useState(createEmptySupplierForm);
  const [newOrder, setNewOrder] = useState(createEmptyPurchaseOrderForm);
  const [supplierErrors, setSupplierErrors] = useState<ProcurementFormErrors>({});
  const [purchaseErrors, setPurchaseErrors] = useState<ProcurementFormErrors>({});
  const [receiptErrors, setReceiptErrors] = useState<ProcurementFormErrors>({});
  const [isB2B, setIsB2B] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [b2bLinks, setB2bLinks] = useState<Record<string, { linked: boolean; purchaseOrder?: PurchaseOrder }>>({});
  const [receiptDrawerOrder, setReceiptDrawerOrder] = useState<PurchaseOrder | null>(null);
  const [receiptBundle, setReceiptBundle] = useState<PurchaseReceiptBundle | null>(null);
  const [isReceiptLoading, setIsReceiptLoading] = useState(false);
  const [receiptForm, setReceiptForm] = useState(createEmptyReceiptForm);
  const localWriteVersionRef = useRef(0);

  const loadData = useCallback(async () => {
    const loadStartedAtVersion = localWriteVersionRef.current;
    try {
      setIsLoading(true);
      const [suppliersData, salesData] = await Promise.all([
        procurementService.getAllSuppliers(),
        orderService.getAll(),
      ]);
      const ordersData = canReadProcurement ? await procurementService.getAllOrders() : [];

      const hasLocalWriteDuringLoad = localWriteVersionRef.current !== loadStartedAtVersion;
      setSuppliers(prev => hasLocalWriteDuringLoad ? mergePreservingLocalWrites(prev, suppliersData) : suppliersData);
      setOrders(prev => hasLocalWriteDuringLoad ? mergePreservingLocalWrites(prev, ordersData) : ordersData);
      setSalesOrders(salesData);
    } catch {
      notify('error', t.loadDataFail || 'Failed to load procurement data');
    } finally {
      setIsLoading(false);
    }
  }, [canReadProcurement, notify, t.loadDataFail]);

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

  const purchaseCostPreview = useMemo(() => calculatePurchaseCostPreview(newOrder), [newOrder]);

  const receiptReadyCount = useMemo(
    () => orders.filter(order => ['approved', 'in_transit', 'received'].includes(order.status)).length,
    [orders],
  );

  const displayedPurchaseOrders = useMemo(
    () => activeDesk === 'receipts'
      ? orders.filter(order => ['approved', 'in_transit', 'received'].includes(order.status))
      : orders,
    [activeDesk, orders],
  );

  const switchProcurementDesk = useCallback((desk: ProcurementDeskTab) => {
    setActiveDesk(desk);
  }, []);

  const clearSupplierError = useCallback((field: string) => {
    setSupplierErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearPurchaseError = useCallback((field: string) => {
    setPurchaseErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearReceiptError = useCallback((field: string) => {
    setReceiptErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

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

  const getSupplierLabel = useCallback((supplier?: Pick<Supplier, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'supplierDisplayName'> | null) => {
    if (!supplier) return '';
    if (language === 'en') {
      return supplier.nameEn || supplier.name || supplier.nameZh || supplier.nameVi || supplier.supplierDisplayName || '';
    }
    if (language === 'vi') {
      return supplier.nameVi || supplier.nameEn || supplier.nameZh || supplier.name || supplier.supplierDisplayName || '';
    }
    return supplier.nameZh || supplier.name || supplier.nameEn || supplier.nameVi || supplier.supplierDisplayName || '';
  }, [language]);

  const getOrderStatusLabel = useCallback((status: PurchaseOrder['status']) => {
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
  }, [language, t]);

  const formatDateOnly = useCallback((value?: string) => {
    if (!value) return '-';
    const [datePart] = String(value).split('T');
    return datePart || value;
  }, []);

  const supplierColumns = useMemo(
    () => buildSupplierColumns({ t, getSupplierLabel }),
    [getSupplierLabel, t],
  );

  const updatePurchaseStatus = async (order: PurchaseOrder, status: PurchaseOrder['status']) => {
    if (!canWriteProcurement) {
      notify('warning', '当前角色只能查看采购数据，不能变更采购状态');
      return;
    }
    try {
      const updatedOrder = await procurementService.updateOrderStatus(order.id, status);
      setOrders(prev => prev.map(item => item.id === order.id ? updatedOrder : item));
      if (status === 'approved') notify('success', t.paymentVerified || '采购单已审核');
      if (status === 'in_transit') notify('success', t.activeTransit || '采购单已发运');
      if (status === 'received') notify('success', `${getOrderStatusLabel(status)} / ${language === 'en' ? 'stock received' : language === 'vi' ? 'đã nhập kho' : '已入库'}`);
    } catch {
      notify('error', t.connectionFailed || 'Purchase status update failed');
    }
  };

  const resetReceiptForm = (order?: PurchaseOrder | null, bundle?: PurchaseReceiptBundle | null) => {
    setReceiptForm(createReceiptFormForOrder(order, bundle));
    setReceiptErrors({});
  };

  const openReceiptDrawer = async (order: PurchaseOrder) => {
    try {
      switchProcurementDesk('receipts');
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
    if (!canWriteProcurement) {
      notify('warning', '当前角色只能查看采购收货批次，不能保存收货');
      return;
    }
    const nextErrors = validatePurchaseReceiptForm(receiptForm, receiptDrawerOrder, receiptBundle);
    if (Object.keys(nextErrors).length) {
      setReceiptErrors(nextErrors);
      notify('error', Object.values(nextErrors)[0] || '请先修正收货批次');
      return;
    }
    const quantity = Number(receiptForm.quantity);
    const acceptedQuantity = Number(receiptForm.acceptedQuantity || 0);
    const rejectedQuantity = Number(receiptForm.rejectedQuantity || 0);

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
      setReceiptErrors({});
      notify('success', '收货批次已入账');
    } catch {
      notify('error', t.saveFail || '收货批次保存失败');
    } finally {
      setIsReceiptLoading(false);
    }
  };

  const purchaseOrderColumns = useMemo(
    () => buildPurchaseOrderColumns({ t, getOrderStatusLabel, formatDateOnly }),
    [formatDateOnly, getOrderStatusLabel, t],
  );

  const renderPurchaseOrderActions = (order: PurchaseOrder) => (
    <div className="flex justify-end gap-2">
      {order.status === 'pending' && canWriteProcurement && (
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
      {order.status === 'approved' && canWriteProcurement && (
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
    if (!canWriteProcurement) {
      notify('warning', '当前角色只能查看供应商，不能新增供应商');
      return;
    }
    const nextErrors = validateSupplierForm(newSupplier);
    if (Object.keys(nextErrors).length) {
      setSupplierErrors(nextErrors);
      notify('error', Object.values(nextErrors)[0] || '请先补全供应商信息');
      return;
    }

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
      setNewSupplier(createEmptySupplierForm());
      setSupplierErrors({});
      switchProcurementDesk('suppliers');
      notify('success', t.supplierCreated);
    } catch {
      notify('error', t.supplierCreateFail);
    }
  };

  const addOrder = async () => {
    if (!canWriteProcurement) {
      notify('warning', '当前角色只能查看采购单，不能新增采购单');
      return;
    }
    const nextErrors = validatePurchaseOrderForm(newOrder, isB2B);
    if (Object.keys(nextErrors).length) {
      setPurchaseErrors(nextErrors);
      notify('error', Object.values(nextErrors)[0] || '请先补全采购单信息');
      return;
    }
    const supplier = suppliers.find(item => item.id === newOrder.supplierId);
    if (!supplier) {
      setPurchaseErrors({ supplierId: '请选择供应商' });
      notify('error', '请选择供应商');
      return;
    }
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
      setNewOrder(createEmptyPurchaseOrderForm());
      setPurchaseErrors({});
      switchProcurementDesk('orders');
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
      title={getModuleTitle('procurement', language)}
      subtitle={getModuleDescription('procurement', language)}
    >
      <DocumentInputGuide
        testId="procurement-input-guide"
        eyebrow="采购 / 供应商 / 收货路线"
        title="供应商、采购单、收货动作必须分清"
        description="采购页不能把供应商建档、采购开单、分批收货、入库、差异处理混成一个大表。成熟进销存习惯是先维护供应商，再开采购单和明细行，到货后按批次收货并回写库存；短收、拒收、质检差异再进入差异/RMA链。"
        tone="amber"
        steps={[
          { title: '供应商主数据', description: '维护供应商多名称、多地址、多联系人和账期，不在这里做收货。', badge: '主数据' },
          { title: '采购单', description: '录采购单头和物料明细，确认数量、单价、币种、交期。', badge: '开单' },
          { title: '分批收货', description: '按到货批次收货，保存后必须回读采购单状态和库存入库。', badge: '执行' },
          { title: '差异闭环', description: '短收、拒收、质量问题进入差异处理或RMA，不直接改采购单历史。', badge: '异常' },
        ]}
        boundaries={[
          { title: '本区负责', items: ['供应商', '采购单', '采购明细', '分批收货', '入库关联'] },
          { title: '转入其他区', items: ['库存调拨', '财务付款', '异常线索复核', 'RMA补偿'] },
        ]}
        evidence={['供应商能查到', '采购单能回读', '收货后库存变化', '差异能追踪']}
      />

      <ProcurementStats t={t} supplierCount={suppliers.length} stats={stats} />

      <ProcurementDeskNavigator
        language={language}
        activeDesk={activeDesk}
        supplierCount={suppliers.length}
        orderCount={orders.length}
        receiptReadyCount={receiptReadyCount}
        onChange={switchProcurementDesk}
      />

      {activeDesk === 'suppliers' && (
        <SupplierWorkspace
          t={t}
          filteredSuppliers={filteredSuppliers}
          supplierColumns={supplierColumns}
          supplierSearch={supplierSearch}
          setSupplierSearch={setSupplierSearch}
          isLoading={isLoading}
          newSupplier={newSupplier}
          setNewSupplier={setNewSupplier}
          supplierErrors={supplierErrors}
          clearSupplierError={clearSupplierError}
          addSupplier={addSupplier}
          canWrite={canWriteProcurement}
        />
      )}

      {(activeDesk === 'orders' || activeDesk === 'receipts') && (
        <PurchaseOrderWorkspace
          t={t}
          mode={activeDesk === 'receipts' ? 'receipts' : 'orders'}
          orders={displayedPurchaseOrders}
          purchaseOrderColumns={purchaseOrderColumns}
          purchaseSearch={purchaseSearch}
          setPurchaseSearch={setPurchaseSearch}
          isLoading={isLoading}
          renderPurchaseOrderActions={renderPurchaseOrderActions}
          newOrder={newOrder}
          setNewOrder={setNewOrder}
          purchaseErrors={purchaseErrors}
          clearPurchaseError={clearPurchaseError}
          addOrder={addOrder}
          isB2B={isB2B}
          setIsB2B={setIsB2B}
          salesOrders={salesOrders}
          b2bLinks={b2bLinks}
          suppliers={suppliers}
          getSupplierLabel={getSupplierLabel}
          purchaseCostPreview={purchaseCostPreview}
          canWrite={canWriteProcurement}
        />
      )}

      {isLoading && (
        <div className="text-xs text-slate-400 font-bold">{t.loading || '加载中…'}</div>
      )}

      {receiptDrawerOrder && (
        <PurchaseReceiptDrawer
          receiptDrawerOrder={receiptDrawerOrder}
          receiptBundle={receiptBundle}
          receiptForm={receiptForm}
          setReceiptForm={setReceiptForm}
          receiptErrors={receiptErrors}
          clearReceiptError={clearReceiptError}
          isReceiptLoading={isReceiptLoading}
          submitReceipt={submitReceipt}
          onClose={() => setReceiptDrawerOrder(null)}
          canWrite={canWriteProcurement}
        />
      )}
    </PageShell>
  );
};

export default Procurement;


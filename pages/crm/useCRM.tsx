import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Customer, RiskLevel, Contact, CustomerPoolHistoryEntry, CustomerAddress, TeamMember } from '../../types';
import { getRiskInsight } from '../../services/geminiService';
import { customerService } from '../../services/customer.service';
import teamService from '../../services/team.service';
import { useAppContext } from '../../app/AppContext';
import { getCustomerDisplayName } from '../../utils/customerName';
import { getCustomerPoolState } from '../../utils/customerPool';
import { normalizeCustomerAddresses } from '../../utils/customerAddressV2';
import { buildCRMColumns } from './CRMColumns';
import { formatImportedCustomers, type ImportedCustomerRow } from './useCRMImport';
import { readCRMUrlState } from './crmUrlState';

export function useCRM() {
  const { t, formatPrice, notify, currentUser, language, registerUnsavedChanges } = useAppContext();
  const managerSegmentScope =
    currentUser.role === 'manager' && currentUser.segment && currentUser.segment !== 'mixed'
      ? currentUser.segment
      : null;
  const canCreateCustomer = currentUser.role === 'admin' || currentUser.role === 'manager' || currentUser.role === 'sales';
  const canImportCustomer = currentUser.role === 'admin' || currentUser.role === 'manager';
  const [initialUrlState] = useState(readCRMUrlState);

  const [data, setData] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(initialUrlState.currentPage);
  const [pageSize] = useState(30);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [viewMode, setViewMode] = useState<'my' | 'public'>(initialUrlState.viewMode);
  const [segmentFilter, setSegmentFilter] = useState<'all' | 'direct' | 'channel' | 'mixed'>(
    managerSegmentScope || initialUrlState.segmentFilter,
  );
  const [searchKeyword, setSearchKeyword] = useState(initialUrlState.searchKeyword);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [poolReason, setPoolReason] = useState('');
  const [poolSalespersonId, setPoolSalespersonId] = useState('');
  const [isPoolUpdating, setIsPoolUpdating] = useState(false);
  const [poolHistory, setPoolHistory] = useState<CustomerPoolHistoryEntry[]>([]);
  const [poolHistoryLatest, setPoolHistoryLatest] = useState<CustomerPoolHistoryEntry | null>(null);
  const [poolHistorySummary, setPoolHistorySummary] = useState<{
    poolState: 'public' | 'internal' | 'private';
    salespersonId: string | null;
    poolReason: string | null;
    poolUpdatedAt: string | null;
    poolUpdatedBy: string | null;
  } | null>(null);
  const [loadingPoolHistory, setLoadingPoolHistory] = useState(false);
  const [salesAssignees, setSalesAssignees] = useState<TeamMember[]>([]);
  const licenseInputRef = useRef<HTMLInputElement>(null);
  const hasMountedFiltersRef = useRef(false);
  const customerSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const selectedCustomerRef = useRef<Customer | null>(null);
  const selectedCustomerId = selectedCustomer?.id ?? null;
  const emptyScopeStats = {
    total: 0,
    publicPool: 0,
    internalPool: 0,
    privatePool: 0,
    overdueAmount: 0,
    creditHoldCount: 0,
    shipmentHoldCount: 0,
  };
  const [scopeStats, setScopeStats] = useState(emptyScopeStats);
  const [segmentBreakdown, setSegmentBreakdown] = useState<Array<typeof emptyScopeStats & { segment: 'direct' | 'channel' | 'mixed' }>>([
    { ...emptyScopeStats, segment: 'direct' },
    { ...emptyScopeStats, segment: 'channel' },
    { ...emptyScopeStats, segment: 'mixed' },
  ]);

  const canEditCustomer = (customer: Customer | null | undefined) => {
    if (!customer) return false;
    if (currentUser.role === 'admin' || currentUser.role === 'manager') return true;
    if (currentUser.role === 'sales') {
      return getCustomerPoolState(customer) === 'private' && String(customer.assignedSalespersonId || '') === String(currentUser.id);
    }
    return false;
  };

  const canEditSelectedCustomer = canEditCustomer(selectedCustomer);

  useEffect(() => {
    selectedCustomerRef.current = selectedCustomer;
  }, [selectedCustomer]);

  useEffect(() => {
    setAiInsight(null);
  }, [selectedCustomer?.id]);

  useEffect(() => {
    setPoolReason(selectedCustomer?.poolReason || '');
    setPoolSalespersonId(selectedCustomer?.assignedSalespersonId || '');
  }, [selectedCustomer?.id, selectedCustomer?.poolReason, selectedCustomer?.assignedSalespersonId]);

  useEffect(() => {
    let active = true;

    if (!selectedCustomerId) {
      setPoolHistory([]);
      setPoolHistoryLatest(null);
      setPoolHistorySummary(null);
      return;
    }

    setLoadingPoolHistory(true);
    customerService
      .getPoolHistory(selectedCustomerId)
      .then((result) => {
        if (!active) return;
        setPoolHistory(result.history || []);
        setPoolHistoryLatest(result.latest || null);
        setPoolHistorySummary(result.currentPool || null);
      })
      .catch(() => {
        notify('error', '客户池历史加载失败');
      })
      .finally(() => {
        if (active) setLoadingPoolHistory(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCustomerId, notify]);

  useEffect(() => {
    if (!hasMountedFiltersRef.current) {
      hasMountedFiltersRef.current = true;
      return;
    }
    setCurrentPage(1);
  }, [searchKeyword, segmentFilter, viewMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      if (viewMode === 'my') url.searchParams.delete('crmView');
      else url.searchParams.set('crmView', viewMode);
      if (segmentFilter === 'all') url.searchParams.delete('crmSegment');
      else url.searchParams.set('crmSegment', segmentFilter);
      if (searchKeyword.trim()) url.searchParams.set('crmSearch', searchKeyword.trim());
      else url.searchParams.delete('crmSearch');
      if (currentPage === 1) url.searchParams.delete('crmPage');
      else url.searchParams.set('crmPage', String(currentPage));
      window.history.replaceState(window.history.state, '', url);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [currentPage, searchKeyword, segmentFilter, viewMode]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      customerService
        .getPage({
          page: currentPage,
          pageSize,
          search: searchKeyword,
          segment: segmentFilter === 'all' ? undefined : segmentFilter,
          viewMode,
        }, { signal: controller.signal })
        .then((result) => {
          setData(result.rows.map((row) => ({
            ...row,
            displayName: getCustomerDisplayName(row, language),
          })));
          setTotalCustomers(result.total);
          setTotalPages(result.totalPages);
          if (currentPage > result.totalPages) setCurrentPage(result.totalPages);
        })
        .catch((error) => {
          if (error?.name !== 'CanceledError' && error?.name !== 'AbortError') {
            notify('error', '客户列表加载失败');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentPage, language, notify, pageSize, reloadVersion, searchKeyword, segmentFilter, viewMode]);

  useEffect(() => {
    const controller = new AbortController();
    customerService
      .getStats({ signal: controller.signal })
      .then((stats) => {
        setScopeStats({
          total: stats.total,
          publicPool: stats.publicPool,
          internalPool: stats.internalPool,
          privatePool: stats.privatePool,
          overdueAmount: stats.overdueAmount,
          creditHoldCount: stats.creditHoldCount,
          shipmentHoldCount: stats.shipmentHoldCount,
        });
        setSegmentBreakdown(stats.segmentBreakdown);
      })
      .catch((error) => {
        if (error?.name !== 'CanceledError' && error?.name !== 'AbortError') {
          notify('error', '客户统计加载失败');
        }
      });
    return () => controller.abort();
  }, [notify, reloadVersion]);

  useEffect(() => {
    if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
      setSalesAssignees([]);
      return;
    }

    teamService
      .getAll()
      .then((rows) => {
        setSalesAssignees(rows.filter((member) => member.role === 'sales'));
      })
      .catch(() => {
        notify('error', '销售人员列表加载失败');
      });
  }, [currentUser.role, notify]);

  useEffect(() => {
    return () => {
      Object.values(customerSaveTimersRef.current).forEach((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
      customerSaveTimersRef.current = {};
      registerUnsavedChanges('crm-customer-autosave', '客户资料', false);
    };
  }, [registerUnsavedChanges]);

  const scheduleCustomerPersist = (nextCustomer: Customer, successMessage?: string) => {
    if (!canEditCustomer(nextCustomer)) {
      notify('warning', '当前客户仅可查看，不能直接编辑');
      return;
    }

    const timerKey = nextCustomer.id;
    const existingTimer = customerSaveTimersRef.current[timerKey];
    if (existingTimer) clearTimeout(existingTimer);
    registerUnsavedChanges('crm-customer-autosave', '客户资料正在保存', true);

    customerSaveTimersRef.current[timerKey] = setTimeout(() => {
      customerService
        .update(nextCustomer)
        .then((updated) => {
          setData((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...updated, displayName: getCustomerDisplayName(updated, language) } : c)),
          );
          setSelectedCustomer((current) => (current?.id === updated.id ? updated : current));
          if (successMessage) notify('success', successMessage);
        })
        .catch(() => {
          notify('error', '客户资料更新失败');
        })
        .finally(() => {
          delete customerSaveTimersRef.current[timerKey];
          if (Object.keys(customerSaveTimersRef.current).length === 0) {
            registerUnsavedChanges('crm-customer-autosave', '客户资料正在保存', false);
          }
        });
    }, 350);
  };

  const commitSelectedCustomer = (nextCustomer: Customer, successMessage?: string) => {
    selectedCustomerRef.current = nextCustomer;
    setSelectedCustomer(nextCustomer);
    setData((prev) =>
      prev.map((customer) =>
        customer.id === nextCustomer.id
          ? { ...nextCustomer, displayName: getCustomerDisplayName(nextCustomer, language) }
          : customer,
      ),
    );
    scheduleCustomerPersist(nextCustomer, successMessage);
  };

  const mutateSelectedCustomer = (
    updater: (current: Customer) => Customer,
    options?: {
      deniedMessage?: string;
      successMessage?: string;
    },
  ) => {
    const current = selectedCustomerRef.current;
    if (!current) return;
    if (!canEditCustomer(current)) {
      notify('warning', options?.deniedMessage || '当前客户仅可查看，不能编辑主数据');
      return;
    }

    commitSelectedCustomer(updater(current), options?.successMessage);
  };

  const handleUpdateCustomerMeta = (
    patch: Partial<Pick<Customer, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'nameAliases' | 'notes'>>,
  ) => {
    mutateSelectedCustomer((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    if (!selectedCustomer?.id) return;
    const latest = data.find((row) => row.id === selectedCustomer.id);
    if (latest && latest !== selectedCustomer) {
      setSelectedCustomer(latest);
    }
  }, [data, selectedCustomer]);

  const filteredData = data;

  const [newCustomer, setNewCustomer] = useState<Partial<Customer>>({
    name: '',
    nameZh: '',
    nameEn: '',
    nameVi: '',
    nameAliases: [],
    addresses: [],
    creditLimit: 50000,
    termsDays: 30,
    riskLevel: RiskLevel.MEDIUM,
    segment: managerSegmentScope || 'direct',
    poolState: 'internal',
    contacts: [],
    isPublicPool: false,
    status: 'active',
  });

  useEffect(() => {
    if (!managerSegmentScope) return;
    setNewCustomer((prev) => ({
      ...prev,
      segment: managerSegmentScope,
    }));
  }, [managerSegmentScope]);

  const handleCreateCustomer = async () => {
    if (!canCreateCustomer) {
      notify('error', '当前角色不能创建客户');
      return;
    }

    if (!newCustomer.name && !newCustomer.nameZh && !newCustomer.nameEn && !newCustomer.nameVi) {
      notify('error', t.custRequired);
      return;
    }
    const aliases = newCustomer.nameAliases || [];
    const invalidAlias = aliases.find((alias) => String(alias).length > 160);
    if (aliases.length > 50 || invalidAlias) {
      notify('error', '别名最多 50 个，每个最多 160 个字符，请精简后再创建。');
      return;
    }
    const invalidAddress = (newCustomer.addresses || []).find((address) => String(address.fullAddress || '').length > 500);
    if (invalidAddress) {
      notify('error', '完整地址最多 500 个字符，请精简后再创建。');
      return;
    }
    if (String(newCustomer.notes || '').length > 1000) {
      notify('error', '客户备注最多 1000 个字符，请精简后再创建。');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await customerService.create({
        ...newCustomer,
        segment: newCustomer.segment || managerSegmentScope || 'direct',
        usedCredit: 0,
        contacts: newCustomer.contacts || [],
        addresses: normalizeCustomerAddresses(newCustomer.addresses || null),
        historicalOrderCount: 0,
        avgOrderInterval: 0,
      } as Customer);

      setData((prev) => [{ ...created, displayName: getCustomerDisplayName(created, language) }, ...prev]);
      setCurrentPage(1);
      setReloadVersion((version) => version + 1);
      setIsCreateOpen(false);
      setNewCustomer({
        name: '',
        nameZh: '',
        nameEn: '',
        nameVi: '',
        nameAliases: [],
        addresses: [],
        creditLimit: 50000,
        termsDays: 30,
        riskLevel: RiskLevel.MEDIUM,
        segment: managerSegmentScope || 'direct',
        poolState: 'internal',
        contacts: [],
      });
      notify('success', t.custCreated);
    } catch {
      notify('error', t.custCreateFail);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImport = async (newData: ImportedCustomerRow[]) => {
    try {
      const formattedData = formatImportedCustomers(newData, managerSegmentScope);
      await customerService.import(formattedData);
      setCurrentPage(1);
      setReloadVersion((version) => version + 1);
      notify('success', `${t.custImportSuccess}: ${formattedData.length}`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : t.custImportFail);
    }
  };

  const handleExport = async () => {
    await customerService.downloadExport({
      search: searchKeyword,
      segment: segmentFilter === 'all' ? undefined : segmentFilter,
      viewMode,
    });
    notify('success', '客户数据已导出');
  };

  const fetchAiInsight = async (customer: Customer) => {
    setLoadingAi(true);
    const insight = await getRiskInsight(customer, t);
    setAiInsight(insight);
    setLoadingAi(false);
  };

  const handleAddContact = () => {
    mutateSelectedCustomer((current) => {
      const newContact: Contact = { name: '', position: '', phone: '', email: '', isPrimary: false };
      return { ...current, contacts: [...(current.contacts || []), newContact] };
    });
  };

  const updateContact = <K extends keyof Contact>(idx: number, field: K, value: Contact[K]) => {
    mutateSelectedCustomer((current) => {
      const newContacts = [...(current.contacts || [])];
      newContacts[idx] = { ...newContacts[idx], [field]: value };
      return { ...current, contacts: newContacts };
    });
  };

  const handleAddAddress = () => {
    mutateSelectedCustomer((current) => {
      const nextAddresses = [
        ...(current.addresses || []),
        { type: 'legal' as const, fullAddress: '', isPrimary: (current.addresses || []).length === 0 },
      ];
      return { ...current, addresses: nextAddresses };
    });
  };

  const updateAddress = <K extends keyof CustomerAddress>(idx: number, field: K, value: CustomerAddress[K]) => {
    mutateSelectedCustomer((current) => {
      const nextAddresses = [...(current.addresses || [])];
      nextAddresses[idx] = { ...nextAddresses[idx], [field]: value };
      return { ...current, addresses: nextAddresses };
    });
  };

  const handleLicenseUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedCustomerRef.current) return;
    if (!canEditCustomer(selectedCustomerRef.current)) {
      notify('warning', '当前客户仅可查看，不能编辑主数据');
      return;
    }

    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const current = selectedCustomerRef.current;
      if (!current) return;
      commitSelectedCustomer(
        { ...current, licenseUrl: String(reader.result || ''), licenseStatus: 'verified' as const },
        '证照上传成功',
      );
    };
    reader.onerror = () => notify('error', '证照上传失败');
    reader.readAsDataURL(file);
  };

  const handlePoolAction = async (poolState: 'public' | 'internal' | 'private') => {
    if (!selectedCustomer) return;
    if (poolState === 'private' && !poolSalespersonId) {
      notify('error', '请先填写分配到的业务员编号');
      return;
    }

    setIsPoolUpdating(true);
    try {
      const updated = await customerService.updatePool(selectedCustomer.id, {
        poolState,
        salespersonId: poolState === 'private' ? poolSalespersonId : null,
        reason: poolReason || undefined,
      });
      setData((prev) => prev.map((c) => (c.id === updated.id ? { ...updated, displayName: getCustomerDisplayName(updated, language) } : c)));
      setSelectedCustomer(updated);
      setReloadVersion((version) => version + 1);
      notify('success', '客户池已更新');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '客户池更新失败');
    } finally {
      setIsPoolUpdating(false);
    }
  };

  const columns = useMemo(() => buildCRMColumns(t), [t]);

  return {
    t,
    formatPrice,
    notify,
    data,
    isLoading,
    filteredData,
    selectedCustomer,
    setSelectedCustomer,
    aiInsight,
    loadingAi,
    currentUser,
    canCreateCustomer,
    canImportCustomer,
    canEditSelectedCustomer,
    managerSegmentScope,
    scopeStats,
    segmentBreakdown,
    currentPage,
    pageSize,
    totalCustomers,
    totalPages,
    setCurrentPage,
    viewMode,
    setViewMode,
    segmentFilter,
    setSegmentFilter,
    searchKeyword,
    setSearchKeyword,
    isCreateOpen,
    setIsCreateOpen,
    isSubmitting,
    setIsSubmitting,
    licenseInputRef,
    newCustomer,
    setNewCustomer,
    handleCreateCustomer,
    handleUpdateCustomerMeta,
    handleImport,
    handleExport,
    fetchAiInsight,
    handleAddContact,
    updateContact,
    handleAddAddress,
    updateAddress,
    handleLicenseUpload,
    poolReason,
    setPoolReason,
    poolSalespersonId,
    setPoolSalespersonId,
    isPoolUpdating,
    handlePoolAction,
    poolHistory,
    poolHistoryLatest,
    poolHistorySummary,
    loadingPoolHistory,
    salesAssignees,
    columns,
    setData,
  };
}

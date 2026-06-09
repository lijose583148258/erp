import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Customer, RiskLevel, Contact, CustomerPoolHistoryEntry, CustomerAddress, TeamMember } from '../../types';
import { getRiskInsight } from '../../services/geminiService';
import { customerService } from '../../services/customer.service';
import teamService from '../../services/team.service';
import { useAppContext } from '../../app/AppContext';
import { getCustomerDisplayName } from '../../utils/customerName';
import { getCustomerPoolState } from '../../utils/customerPool';
import { normalizeCustomerAddresses } from '../../utils/customerAddressV2';
import { matchesScopedSearch } from '../../utils/scopedSearch';
import { buildCRMColumns } from './CRMColumns';
import { formatImportedCustomers, type ImportedCustomerRow } from './useCRMImport';

export function useCRM() {
  const { t, formatPrice, notify, currentUser, language, registerUnsavedChanges } = useAppContext();
  const managerSegmentScope =
    currentUser.role === 'manager' && currentUser.segment && currentUser.segment !== 'mixed'
      ? currentUser.segment
      : null;
  const canCreateCustomer = currentUser.role === 'admin' || currentUser.role === 'manager' || currentUser.role === 'sales';
  const canImportCustomer = currentUser.role === 'admin' || currentUser.role === 'manager';

  const [data, setData] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [viewMode, setViewMode] = useState<'my' | 'public'>('my');
  const [segmentFilter, setSegmentFilter] = useState<'all' | 'direct' | 'channel' | 'mixed'>('all');
  const [searchKeyword, setSearchKeyword] = useState('');
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
  const customerSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const selectedCustomerRef = useRef<Customer | null>(null);
  const selectedCustomerId = selectedCustomer?.id ?? null;

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
    customerService.getAll().then((rows) => {
      setData(
        rows.map((row) => ({
          ...row,
          displayName: getCustomerDisplayName(row, language),
        })),
      );
    });
  }, [language]);

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

  const visibleScopeData = useMemo(() => {
    return data.filter((customer) => {
      const normalizedSegment = customer.segment || 'mixed';
      return !managerSegmentScope || normalizedSegment === managerSegmentScope || normalizedSegment === 'mixed';
    });
  }, [data, managerSegmentScope]);

  const filteredData = useMemo(() => {
    return visibleScopeData.filter((c) => {
      const normalizedSegment = c.segment || 'mixed';
      const normalizedPool = getCustomerPoolState(c);
      const matchesPool = viewMode === 'public' ? normalizedPool === 'public' : normalizedPool !== 'public';
      const matchesSegment = segmentFilter === 'all' ? true : normalizedSegment === segmentFilter;
      const matchesKeyword = matchesScopedSearch(
        [
          c.id,
          c.name,
          c.nameZh,
          c.nameEn,
          c.nameVi,
          c.displayName,
          c.salespersonName,
          ...(c.nameAliases || []),
          ...(c.contacts || []).flatMap((contact) => [
            contact.name,
            contact.role,
            contact.position,
            contact.phone,
            contact.email,
            contact.mobile,
            contact.whatsapp,
            contact.wechat,
            contact.department,
            contact.siteLabel,
          ]),
          ...(c.addresses || []).flatMap((address) => [
            address.label,
            address.fullAddress,
            address.city,
            address.region,
            address.countryCode,
            address.registeredName,
            address.registrationNo,
            address.taxNo,
          ]),
        ],
        searchKeyword,
      );
      return matchesPool && matchesSegment && matchesKeyword;
    });
  }, [visibleScopeData, viewMode, segmentFilter, searchKeyword]);

  const scopeStats = useMemo(() => {
    return {
      total: visibleScopeData.length,
      publicPool: visibleScopeData.filter((customer) => getCustomerPoolState(customer) === 'public').length,
      internalPool: visibleScopeData.filter((customer) => getCustomerPoolState(customer) === 'internal').length,
      privatePool: visibleScopeData.filter((customer) => getCustomerPoolState(customer) === 'private').length,
      overdueAmount: visibleScopeData.reduce((sum, customer) => sum + Number(customer.overdueAmount || 0), 0),
      creditHoldCount: visibleScopeData.filter((customer) => Boolean(customer.creditHold)).length,
      shipmentHoldCount: visibleScopeData.filter((customer) => Boolean(customer.shipmentHold)).length,
    };
  }, [visibleScopeData]);

  const segmentBreakdown = useMemo(() => {
    const segments: Array<'direct' | 'channel' | 'mixed'> = ['direct', 'channel', 'mixed'];

    return segments.map((segment) => {
      const rows = visibleScopeData.filter((customer) => (customer.segment || 'mixed') === segment);
      return {
        segment,
        total: rows.length,
        publicPool: rows.filter((customer) => getCustomerPoolState(customer) === 'public').length,
        internalPool: rows.filter((customer) => getCustomerPoolState(customer) === 'internal').length,
        privatePool: rows.filter((customer) => getCustomerPoolState(customer) === 'private').length,
        overdueAmount: rows.reduce((sum, customer) => sum + Number(customer.overdueAmount || 0), 0),
        creditHoldCount: rows.filter((customer) => Boolean(customer.creditHold)).length,
        shipmentHoldCount: rows.filter((customer) => Boolean(customer.shipmentHold)).length,
      };
    });
  }, [visibleScopeData]);

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
      const created = await customerService.import(formattedData);
      setData(created.map((row) => ({ ...row, displayName: getCustomerDisplayName(row, language) })));
      notify('success', `${t.custImportSuccess}: ${created.length}`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : t.custImportFail);
    }
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

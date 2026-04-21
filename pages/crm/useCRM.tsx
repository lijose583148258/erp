import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Customer, RiskLevel, Contact, CustomerPoolHistoryEntry, CustomerAddress, TeamMember } from '../../types';
import { getRiskInsight } from '../../services/geminiService';
import { customerService } from '../../services/customer.service';
import teamService from '../../services/team.service';
import { useAppContext } from '../../app/AppContext';
import type { Column } from '../../components/DataTable';
import { splitCustomerTextList } from '../../utils/customerAlias';
import { getCustomerDisplayName } from '../../utils/customerName';
import { UserRound } from 'lucide-react';
import { getCustomerPoolState } from '../../utils/customerPool';
import { normalizeCustomerAddresses } from '../../utils/customerAddressV2';
import { matchesScopedSearch } from '../../utils/scopedSearch';

type ImportedCustomerRow = Partial<Customer> & Record<string, unknown>;
type ContactImportRecord = Partial<Record<keyof Contact, unknown>> & Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readImportValue = (row: ImportedCustomerRow, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const readImportText = (row: ImportedCustomerRow, keys: string[], fallback?: string) => {
  const value = readImportValue(row, ...keys);
  return value === undefined ? fallback : String(value).trim();
};

const readImportNumber = (row: ImportedCustomerRow, keys: string[], fallback: number) => {
  const value = readImportValue(row, ...keys);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeContactRecord = (value: unknown): Contact | null => {
  if (!isRecord(value)) return null;
  const source = value as ContactImportRecord;
  const name = String(source.name || source['姓名'] || source.contactName || '').trim();
  const phone = String(source.phone || source.mobile || source['电话'] || source['手机'] || '').trim();
  const email = String(source.email || source['邮箱'] || '').trim();
  const position = String(source.position || source.role || source['职务'] || source['角色'] || '').trim();

  if (!name && !phone && !email) return null;

  return {
    name,
    position,
    phone,
    email,
    isPrimary: Boolean(source.isPrimary),
    role: source.role ? String(source.role) : undefined,
    department: source.department ? String(source.department) : undefined,
    language: source.language === 'zh' || source.language === 'en' || source.language === 'vi' ? source.language : undefined,
    mobile: source.mobile ? String(source.mobile) : undefined,
    whatsapp: source.whatsapp ? String(source.whatsapp) : undefined,
    wechat: source.wechat ? String(source.wechat) : undefined,
    addressId: source.addressId ? String(source.addressId) : undefined,
    siteLabel: source.siteLabel ? String(source.siteLabel) : undefined,
  };
};

const parseImportedContacts = (value: unknown): Contact[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(normalizeContactRecord).filter((contact): contact is Contact => Boolean(contact));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map(normalizeContactRecord).filter((contact): contact is Contact => Boolean(contact))
        : [];
    } catch {
      return [];
    }
  }
  return [];
};

const parseImportedAddresses = (row: ImportedCustomerRow): CustomerAddress[] => {
  const addressesValue = readImportValue(row, 'addresses', 'addressesJson', 'Addresses JSON', '地址JSON');
  const legacyAddress = readImportValue(row, 'address', 'Address', '地址');
  const addresses = Array.isArray(addressesValue)
    ? (addressesValue as CustomerAddress[])
    : typeof addressesValue === 'string'
      ? addressesValue
      : undefined;

  return normalizeCustomerAddresses({
    addresses: addresses || null,
    address: typeof legacyAddress === 'string' ? legacyAddress : null,
  });
};

export function useCRM() {
  const { t, formatPrice, notify, currentUser, language } = useAppContext();
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
    };
  }, []);

  const scheduleCustomerPersist = (nextCustomer: Customer, successMessage?: string) => {
    if (!canEditCustomer(nextCustomer)) {
      notify('warning', '当前客户仅可查看，不能直接编辑');
      return;
    }

    const timerKey = nextCustomer.id;
    const existingTimer = customerSaveTimersRef.current[timerKey];
    if (existingTimer) clearTimeout(existingTimer);

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
      const formattedData: Customer[] = newData.map((item) => ({
        id: '',
        name: readImportText(item, ['客户名称', 'Customer Name', 'name'], 'Unknown') || 'Unknown',
        nameZh: readImportText(item, ['中文名称', 'nameZh', 'Chinese Name']) || undefined,
        nameEn: readImportText(item, ['英文名称', 'nameEn', 'English Name']) || undefined,
        nameVi: readImportText(item, ['越南文名称', 'nameVi', 'Vietnamese Name']) || undefined,
        nameAliases: splitCustomerTextList(readImportValue(item, '别名/历史名', 'Alias', 'Aliases', 'aliasNames', 'nameAliases') as string[] | string | null),
        contacts: parseImportedContacts(readImportValue(item, 'contacts', 'contactsJson', 'Contacts JSON', '联系人JSON')),
        addresses: parseImportedAddresses(item),
        termsDays: readImportNumber(item, ['Terms Days', 'termsDays'], 30),
        creditLimit: readImportNumber(item, ['Credit Limit', 'creditLimit'], 50000),
        usedCredit: 0,
        riskLevel: readImportText(item, ['Risk Level', 'riskLevel'], 'medium')?.toLowerCase() as RiskLevel,
        segment: readImportText(item, ['Business Line', 'Segment', 'segment'], managerSegmentScope || 'mixed')?.toLowerCase() as Customer['segment'],
        poolState: readImportText(item, ['Pool State', 'poolState'], 'internal')?.toLowerCase() as Customer['poolState'],
        lastOrderDate: new Date().toISOString().split('T')[0],
        status: 'active',
        historicalOrderCount: 0,
        avgOrderInterval: 0,
        isPublicPool: false,
        licenseUrl: readImportText(item, ['License URL', 'licenseUrl']) || undefined,
        licenseStatus: readImportValue(item, 'License URL', 'licenseUrl') ? 'verified' : 'pending',
      }));

      const created = await customerService.import(formattedData);
      setData(created.map((row) => ({ ...row, displayName: getCustomerDisplayName(row, language) })));
      notify('success', `${t.custImportSuccess}: ${created.length}`);
    } catch (error) {
      console.error(error);
      notify('error', t.custImportFail);
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
      console.error(error);
      notify('error', '客户池更新失败');
    } finally {
      setIsPoolUpdating(false);
    }
  };

  const columns: Column<Customer>[] = [
    {
      header: t.customerName,
      key: 'name',
      accessor: (row: Customer) => (
        <div className="flex flex-col">
          <span className="font-bold text-slate-800 dark:text-white text-base group-hover:text-blue-600 transition-colors">
            {row.displayName || row.name}
          </span>
          <span className="text-[10px] text-slate-400 uppercase font-black mt-0.5">ID: {row.id}</span>
        </div>
      ),
    },
    {
      header: t.licenseStatus,
      key: 'license',
      accessor: (row) => {
        const statusColors = {
          verified: 'bg-emerald-100 text-emerald-600 border-emerald-200',
          expired: 'bg-rose-100 text-rose-600 border-rose-200',
          pending: 'bg-slate-100 text-slate-400 border-slate-200',
        };
        return (
          <span className={`px-2 py-0.5 rounded-lg text-[11px] font-black uppercase border ${statusColors[row.licenseStatus || 'pending']}`}>
            {t[row.licenseStatus || 'pending']}
          </span>
        );
      },
    },
    {
      header: t.salesperson,
      key: 'tracking',
      accessor: (row: Customer) => (
        <div className="flex items-center text-xs group/rep cursor-pointer">
          <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-xl mr-3 group-hover/rep:bg-blue-600 group-hover/rep:text-white transition-all shadow-sm">
            <UserRound size={14} />
          </div>
          <div className="flex flex-col text-left">
            <span className="text-slate-500 dark:text-slate-400 font-bold group-hover/rep:text-blue-500">{row.salespersonName || t.pending}</span>
            <span className="text-[11px] text-slate-400 font-black uppercase">
              {row.contacts.length} {t.records}
            </span>
          </div>
        </div>
      ),
    },
    {
      header: 'Business Line',
      key: 'segment',
      accessor: (row: Customer) => {
        const normalizedSegment = row.segment || 'mixed';
        const labels: Record<string, { bg: string; text: string; border: string; label: string }> = {
          direct: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800', label: '直销' },
          channel: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', label: '渠道' },
          mixed: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800', label: '混合' },
        };
        const badge = labels[normalizedSegment] || labels.mixed;
        return (
          <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest border ${badge.bg} ${badge.text} ${badge.border}`}>
            {badge.label}
          </span>
        );
      },
    },
    {
      header: 'Pool',
      key: 'poolState',
      accessor: (row: Customer) => {
        const normalizedPool = getCustomerPoolState(row);
        const labels: Record<string, { bg: string; text: string; border: string; label: string }> = {
          public: { bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-200 dark:border-rose-800', label: '公海' },
          internal: { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-200 dark:border-violet-800', label: '内部池' },
          private: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800', label: '私海' },
        };
        const badge = labels[normalizedPool] || labels.private;
        return (
          <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest border ${badge.bg} ${badge.text} ${badge.border}`}>
            {badge.label}
          </span>
        );
      },
    },
    {
      header: t.riskLevel,
      key: 'risk',
      accessor: (row) => (
        <span
          className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
            row.riskLevel === RiskLevel.CRITICAL
              ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800'
              : row.riskLevel === RiskLevel.HIGH
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                : row.riskLevel === RiskLevel.MEDIUM
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                  : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
          }`}
        >
          {row.riskLevel}
        </span>
      ),
    },
  ];

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

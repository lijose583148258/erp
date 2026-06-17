import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, LockKeyhole, Plus, Save, Search, ShieldCheck } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import roleService, { AuthPermission, AuthRole, DataScopeCode } from '../../services/role.service';

type RoleDraft = {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  dataScopes: DataScopeCode[];
  permissions: string[];
};

type ChangeReview = {
  title: string;
  lines: string[];
};

interface RoleManagementPanelProps {
  roles: AuthRole[];
  onRolesChanged: () => void | Promise<void>;
}

const panelInputClass = 'rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50 dark:disabled:bg-slate-900';

const dataScopeOptions: Array<{ code: DataScopeCode; zh: string; en: string; vi: string }> = [
  { code: 'all', zh: '全公司数据', en: 'All company data', vi: 'Toan bo du lieu cong ty' },
  { code: 'own_customers', zh: '仅本人客户', en: 'Own customers only', vi: 'Chi khach hang cua toi' },
  { code: 'team_customers', zh: '团队客户', en: 'Team customers', vi: 'Khach hang nhom' },
  { code: 'finance_visible', zh: '可见财务数据', en: 'Finance visible', vi: 'Xem du lieu tai chinh' },
  { code: 'warehouse_visible', zh: '可见仓储数据', en: 'Warehouse visible', vi: 'Xem du lieu kho' },
  { code: 'procurement_visible', zh: '可见采购数据', en: 'Procurement visible', vi: 'Xem du lieu mua hang' },
];

const copy = {
  zh: {
    title: '角色与权限管理',
    subtitle: '权限变更会影响菜单、接口和数据范围。保存前必须先核对变更预览。',
    create: '新建角色',
    system: '系统角色',
    custom: '自定义角色',
    active: '启用',
    inactive: '停用',
    readonly: '系统角色的编码和启用状态已锁定，权限点仍可由授权管理员调整。',
    code: '角色编码',
    name: '角色名称',
    description: '说明',
    scopes: '数据范围',
    permissions: '权限点',
    permissionSummary: '权限摘要',
    highRisk: '高风险权限',
    noHighRisk: '未选择高风险权限',
    authorizationSheet: '授权确认单',
    search: '搜索权限编码或名称',
    selected: '已选',
    review: '预览变更',
    confirm: '确认保存',
    cancelReview: '继续修改',
    saving: '保存中...',
    codeHint: '小写字母、数字、下划线、中横线或冒号，例如 sales_assistant。',
    emptyPermissions: '没有匹配的权限点',
    saved: '角色权限已保存并回读',
    noChanges: '没有检测到需要保存的变更',
    validationName: '角色名称至少 2 个字符',
    validationCode: '角色编码格式不正确',
    validationPermissions: '至少勾选 1 个权限点',
    loadFail: '角色权限加载失败',
    loading: '正在加载...',
  },
  en: {
    title: 'Role & Permission Management',
    subtitle: 'Permission changes affect menus, APIs, and data scope. Review the diff before saving.',
    create: 'New Role',
    system: 'System Role',
    custom: 'Custom Role',
    active: 'Active',
    inactive: 'Disabled',
    readonly: 'System role code and active state are locked, but authorized admins can adjust permissions.',
    code: 'Role Code',
    name: 'Role Name',
    description: 'Description',
    scopes: 'Data Scopes',
    permissions: 'Permissions',
    permissionSummary: 'Permission summary',
    highRisk: 'High-risk permissions',
    noHighRisk: 'No high-risk permissions selected',
    authorizationSheet: 'Authorization sheet',
    search: 'Search permission code or label',
    selected: 'Selected',
    review: 'Preview Changes',
    confirm: 'Confirm Save',
    cancelReview: 'Keep Editing',
    saving: 'Saving...',
    codeHint: 'Lowercase letters, numbers, underscore, dash, or colon. Example: sales_assistant.',
    emptyPermissions: 'No permissions matched',
    saved: 'Role permissions saved and read back',
    noChanges: 'No changes to save',
    validationName: 'Role name needs at least 2 characters',
    validationCode: 'Role code format is invalid',
    validationPermissions: 'Select at least one permission',
    loadFail: 'Failed to load role permissions',
    loading: 'Loading...',
  },
  vi: {
    title: 'Quan ly vai tro va quyen',
    subtitle: 'Thay doi quyen anh huong menu, API va pham vi du lieu. Hay xem truoc thay doi truoc khi luu.',
    create: 'Tao vai tro',
    system: 'Vai tro he thong',
    custom: 'Vai tro tuy chinh',
    active: 'Dang bat',
    inactive: 'Da tat',
    readonly: 'Ma vai tro he thong va trang thai bat/tat da khoa, nhung quan tri duoc uy quyen van co the sua quyen.',
    code: 'Ma vai tro',
    name: 'Ten vai tro',
    description: 'Mo ta',
    scopes: 'Pham vi du lieu',
    permissions: 'Quyen',
    permissionSummary: 'Tom tat quyen',
    highRisk: 'Quyen rui ro cao',
    noHighRisk: 'Chua chon quyen rui ro cao',
    authorizationSheet: 'Phieu xac nhan uy quyen',
    search: 'Tim ma quyen hoac ten quyen',
    selected: 'Da chon',
    review: 'Xem thay doi',
    confirm: 'Xac nhan luu',
    cancelReview: 'Sua tiep',
    saving: 'Dang luu...',
    codeHint: 'Chu thuong, so, gach duoi, gach ngang hoac dau hai cham. Vi du: sales_assistant.',
    emptyPermissions: 'Khong co quyen phu hop',
    saved: 'Da luu va doc lai quyen vai tro',
    noChanges: 'Khong co thay doi can luu',
    validationName: 'Ten vai tro can it nhat 2 ky tu',
    validationCode: 'Ma vai tro khong hop le',
    validationPermissions: 'Chon it nhat mot quyen',
    loadFail: 'Khong tai duoc quyen vai tro',
    loading: 'Dang tai...',
  },
};

const groupLabels: Record<string, { zh: string; en: string; vi: string }> = {
  dashboard: { zh: '工作台', en: 'Dashboard', vi: 'Bang dieu khien' },
  customers: { zh: '客户与主数据', en: 'Customers & master data', vi: 'Khach hang va du lieu goc' },
  orders: { zh: '销售订单', en: 'Sales orders', vi: 'Don ban hang' },
  collections: { zh: '回款与催收', en: 'Collections', vi: 'Thu tien' },
  finance: { zh: '财务经营', en: 'Finance', vi: 'Tai chinh' },
  contracts: { zh: '合同', en: 'Contracts', vi: 'Hop dong' },
  barter: { zh: '货抵/换货', en: 'Barter settlement', vi: 'Doi tru hang hoa' },
  risk: { zh: '风控', en: 'Risk control', vi: 'Kiem soat rui ro' },
  samples: { zh: '样品', en: 'Samples', vi: 'Mau' },
  shipping: { zh: '出货物流', en: 'Shipping', vi: 'Van chuyen' },
  team: { zh: '组织与权限', en: 'Team & access', vi: 'Nhom va quyen' },
  assets: { zh: '资产', en: 'Assets', vi: 'Tai san' },
  production: { zh: '生产', en: 'Production', vi: 'San xuat' },
  warehouse: { zh: '仓储', en: 'Warehouse', vi: 'Kho' },
  procurement: { zh: '采购', en: 'Procurement', vi: 'Mua hang' },
  audit: { zh: '审计', en: 'Audit', vi: 'Kiem toan' },
};

const highRiskPermissionPattern = /(authorization|admin|manage|write|delete|approve|post|reverse|export|finance|cost|audit)/i;

const isHighRiskPermission = (permission?: AuthPermission | null) => {
  if (!permission) return false;
  return highRiskPermissionPattern.test(`${permission.code} ${permission.resource} ${permission.action}`);
};

const createEmptyDraft = (): RoleDraft => ({
  code: '',
  name: '',
  description: '',
  isActive: true,
  dataScopes: ['own_customers'],
  permissions: ['dashboard.read'],
});

const roleToDraft = (role: AuthRole): RoleDraft => ({
  code: role.code,
  name: role.name,
  description: role.description || '',
  isActive: role.isActive,
  dataScopes: role.dataScopes || [],
  permissions: role.permissions || [],
});

const sameSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((item) => set.has(item));
};

const diffList = (before: string[], after: string[]) => {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((item) => !beforeSet.has(item)).sort(),
    removed: before.filter((item) => !afterSet.has(item)).sort(),
  };
};

const RoleManagementPanel: React.FC<RoleManagementPanelProps> = ({ roles, onRolesChanged }) => {
  const { language, notify } = useAppContext();
  const lang = language === 'en' || language === 'vi' ? language : 'zh';
  const text = copy[lang];
  const [permissions, setPermissions] = useState<AuthPermission[]>([]);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [selectedRoleCode, setSelectedRoleCode] = useState<string | null>(roles[0]?.code || null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>(() => roles[0] ? roleToDraft(roles[0]) : createEmptyDraft());
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<ChangeReview | null>(null);

  useEffect(() => {
    setLoadingPermissions(true);
    roleService.listPermissions()
      .then(setPermissions)
      .catch((error) => notify('error', error instanceof Error ? error.message : text.loadFail))
      .finally(() => setLoadingPermissions(false));
  }, [notify, text.loadFail]);

  useEffect(() => {
    if (isCreating) return;
    const current = roles.find((role) => role.code === selectedRoleCode) || roles[0];
    if (current) {
      setSelectedRoleCode(current.code);
      setDraft(roleToDraft(current));
      setReview(null);
    }
  }, [roles, selectedRoleCode, isCreating]);

  const activeRole = !isCreating ? roles.find((role) => role.code === selectedRoleCode) : undefined;
  const isSystemRole = Boolean(activeRole?.isSystem);
  const selectedPermissionSet = useMemo(() => new Set(draft.permissions), [draft.permissions]);
  const permissionByCode = useMemo(() => new Map(permissions.map(permission => [permission.code, permission])), [permissions]);
  const selectedRiskPermissions = useMemo(
    () => draft.permissions.map(code => permissionByCode.get(code)).filter(isHighRiskPermission),
    [draft.permissions, permissionByCode],
  );
  const selectedPermissionGroups = useMemo(() => {
    const groups = new Set<string>();
    draft.permissions.forEach((code) => {
      const permission = permissionByCode.get(code);
      if (!permission) return;
      groups.add(groupLabels[permission.permissionGroup || permission.group || permission.resource || 'other']?.[lang] || permission.permissionGroup || permission.group || permission.resource || 'other');
    });
    return Array.from(groups);
  }, [draft.permissions, lang, permissionByCode]);

  const filteredPermissionGroups = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase();
    const grouped = new Map<string, AuthPermission[]>();
    permissions
      .filter((permission) => {
        if (!query) return true;
        return `${permission.code} ${permission.label} ${permission.description || ''}`.toLowerCase().includes(query);
      })
      .forEach((permission) => {
        const group = permission.permissionGroup || permission.group || permission.resource || 'other';
        const items = grouped.get(group) || [];
        items.push(permission);
        grouped.set(group, items);
      });

    return Array.from(grouped.entries()).map(([group, items]) => ({
      group,
      label: groupLabels[group]?.[lang] || group,
      items,
    }));
  }, [permissions, permissionSearch, lang]);

  const updateDraft = (updater: (prev: RoleDraft) => RoleDraft) => {
    setReview(null);
    setDraft(updater);
  };

  const startCreate = () => {
    setIsCreating(true);
    setSelectedRoleCode(null);
    setDraft(createEmptyDraft());
    setReview(null);
  };

  const selectRole = (role: AuthRole) => {
    setIsCreating(false);
    setSelectedRoleCode(role.code);
    setDraft(roleToDraft(role));
    setReview(null);
  };

  const toggleDataScope = (scope: DataScopeCode) => {
    updateDraft((prev) => ({
      ...prev,
      dataScopes: prev.dataScopes.includes(scope)
        ? prev.dataScopes.filter((item) => item !== scope)
        : [...prev.dataScopes, scope],
    }));
  };

  const togglePermission = (permissionCode: string) => {
    updateDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permissionCode)
        ? prev.permissions.filter((item) => item !== permissionCode)
        : [...prev.permissions, permissionCode],
    }));
  };

  const validateDraft = () => {
    const normalizedCode = draft.code.trim().toLowerCase();
    if (draft.name.trim().length < 2) return text.validationName;
    if (isCreating && !/^[a-z][a-z0-9_:-]{1,49}$/.test(normalizedCode)) return text.validationCode;
    if (draft.permissions.length === 0) return text.validationPermissions;
    return null;
  };

  const buildReview = (): ChangeReview | null => {
    const original = activeRole ? roleToDraft(activeRole) : createEmptyDraft();
    const permissionDiff = diffList(original.permissions, draft.permissions);
    const scopeDiff = diffList(original.dataScopes, draft.dataScopes);
    const lines: string[] = [];

    if (isCreating) lines.push(`新建角色：${draft.name.trim()} (${draft.code.trim().toLowerCase()})`);
    lines.push(`授权后权限总数：${draft.permissions.length} 个；数据范围：${draft.dataScopes.join(', ') || '-'}`);
    lines.push(`高风险权限：${selectedRiskPermissions.length ? selectedRiskPermissions.map(permission => permission?.label || permission?.code).slice(0, 6).join(', ') : text.noHighRisk}`);
    if (!isCreating && original.name !== draft.name.trim()) lines.push(`名称：${original.name || '-'} -> ${draft.name.trim()}`);
    if (!isCreating && (original.description || '') !== draft.description.trim()) lines.push('说明已变更');
    if (!isCreating && original.isActive !== draft.isActive) lines.push(`状态：${original.isActive ? text.active : text.inactive} -> ${draft.isActive ? text.active : text.inactive}`);
    if (permissionDiff.added.length) lines.push(`新增权限 ${permissionDiff.added.length} 个：${permissionDiff.added.slice(0, 6).join(', ')}${permissionDiff.added.length > 6 ? ' ...' : ''}`);
    if (permissionDiff.removed.length) lines.push(`移除权限 ${permissionDiff.removed.length} 个：${permissionDiff.removed.slice(0, 6).join(', ')}${permissionDiff.removed.length > 6 ? ' ...' : ''}`);
    if (scopeDiff.added.length) lines.push(`新增数据范围：${scopeDiff.added.join(', ')}`);
    if (scopeDiff.removed.length) lines.push(`移除数据范围：${scopeDiff.removed.join(', ')}`);

    const unchanged = !isCreating
      && original.name === draft.name.trim()
      && (original.description || '') === draft.description.trim()
      && original.isActive === draft.isActive
      && sameSet(original.permissions, draft.permissions)
      && sameSet(original.dataScopes, draft.dataScopes);

    if (unchanged) return null;
    return { title: isCreating ? `${text.authorizationSheet}：即将创建角色` : `${text.authorizationSheet}：${draft.code}`, lines };
  };

  const requestReview = () => {
    const validationError = validateDraft();
    if (validationError) {
      notify('warning', validationError);
      return;
    }
    const nextReview = buildReview();
    if (!nextReview) {
      notify('info', text.noChanges);
      return;
    }
    setReview(nextReview);
  };

  const confirmSaveRole = async () => {
    const validationError = validateDraft();
    if (validationError) {
      notify('warning', validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: isCreating ? draft.code.trim().toLowerCase() : undefined,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        isActive: draft.isActive,
        dataScopes: draft.dataScopes,
        permissions: draft.permissions,
      };
      const saved = isCreating
        ? await roleService.createRole(payload)
        : await roleService.updateRole(draft.code, payload);
      await onRolesChanged();
      setIsCreating(false);
      setSelectedRoleCode(saved.code);
      setDraft(roleToDraft(saved));
      setReview(null);
      notify('success', text.saved);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : text.loadFail);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-testid="role-management-panel" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-950 dark:text-white">
              {text.title}
              <span className="sr-only">Role & Permission Management</span>
            </h2>
            <p className="mt-1 max-w-3xl text-sm font-bold text-slate-600 dark:text-slate-300">{text.subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="role-create-start"
          onClick={startCreate}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 dark:bg-white dark:text-slate-950"
        >
          <Plus size={18} className="mr-2" />
          {text.create}
        </button>
      </div>

      <div className="grid lg:grid-cols-[300px_1fr]">
        <div className="max-h-[720px] space-y-2 overflow-y-auto border-b border-slate-200 p-4 dark:border-slate-800 lg:border-b-0 lg:border-r">
          {roles.map((role) => (
            <button
              key={role.code}
              type="button"
              data-testid={`role-card-${role.code}`}
              onClick={() => selectRole(role)}
              className={`w-full rounded-xl border p-4 text-left ${
                !isCreating && selectedRoleCode === role.code
                  ? 'border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30'
                  : 'border-slate-200 bg-slate-50 hover:bg-white dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black text-slate-900 dark:text-white">{role.name}</p>
                  <p className="mt-1 truncate text-xs font-black text-slate-600 dark:text-slate-300">{role.code}</p>
                </div>
                <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-black ${role.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {role.isActive ? text.active : text.inactive}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs font-black text-slate-600 dark:text-slate-300">
                <span>{role.isSystem ? text.system : text.custom}</span>
                <span>{role.permissions.length} {text.permissions}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-6 p-5">
          {isSystemRole && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <LockKeyhole size={18} />
              {text.readonly}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{text.code}</span>
              <input
                data-testid="role-code-input"
                value={draft.code}
                disabled={!isCreating}
                onChange={(event) => updateDraft((prev) => ({ ...prev, code: event.target.value }))}
                className={panelInputClass}
                placeholder="sales_assistant"
              />
              {isCreating && <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{text.codeHint}</span>}
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{text.name}</span>
              <input
                data-testid="role-name-input"
                value={draft.name}
                disabled={isSystemRole}
                onChange={(event) => updateDraft((prev) => ({ ...prev, name: event.target.value }))}
                className={panelInputClass}
                placeholder={text.name}
              />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200 md:col-span-2">
              <span>{text.description}</span>
              <textarea
                data-testid="role-description-input"
                value={draft.description}
                disabled={isSystemRole}
                onChange={(event) => updateDraft((prev) => ({ ...prev, description: event.target.value }))}
                className={`${panelInputClass} min-h-[88px] resize-y`}
                placeholder={text.description}
              />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-900 dark:text-white">{text.scopes}</h3>
              <label className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 dark:bg-slate-950 dark:text-slate-200">
                <input
                  type="checkbox"
                  data-testid="role-active-toggle"
                  checked={draft.isActive}
                  disabled={isSystemRole}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, isActive: event.target.checked }))}
                  className="h-4 w-4 accent-blue-600"
                />
                {draft.isActive ? text.active : text.inactive}
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {dataScopeOptions.map((scope) => (
                <label key={scope.code} className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm font-bold ${
                  draft.dataScopes.includes(scope.code)
                    ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
                }`}>
                  <input
                    type="checkbox"
                    data-testid={`role-scope-${scope.code}`}
                    checked={draft.dataScopes.includes(scope.code)}
                    onChange={() => toggleDataScope(scope.code)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  {scope[lang] || scope.zh}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">{text.permissions}</h3>
                <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">{text.selected}: {draft.permissions.length}</p>
              </div>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                <Search size={16} className="text-slate-500" />
                <input
                  data-testid="role-permission-search"
                  value={permissionSearch}
                  onChange={(event) => setPermissionSearch(event.target.value)}
                  className="min-w-0 bg-transparent text-sm font-bold text-slate-800 outline-none dark:text-slate-100"
                  placeholder={text.search}
                />
              </label>
            </div>

            <div data-testid="role-permission-summary" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-950 md:grid-cols-3">
              <div>
                <div className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{text.permissionSummary}</div>
                <div className="mt-1 text-lg font-black text-slate-950 dark:text-white">{draft.permissions.length}</div>
                <div className="text-xs font-bold text-slate-600 dark:text-slate-300">{selectedPermissionGroups.slice(0, 4).join(' / ') || '-'}</div>
              </div>
              <div>
                <div className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{text.scopes}</div>
                <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{draft.dataScopes.join(', ') || '-'}</div>
              </div>
              <div className={selectedRiskPermissions.length ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200'}>
                <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase">
                  {selectedRiskPermissions.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                  {text.highRisk}
                </div>
                <div className="mt-1 text-sm font-black">
                  {selectedRiskPermissions.length ? `${selectedRiskPermissions.length} ${text.permissions}` : text.noHighRisk}
                </div>
              </div>
            </div>

            {loadingPermissions ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {text.loading}
              </div>
            ) : filteredPermissionGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {text.emptyPermissions}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredPermissionGroups.map((group) => (
                  <div key={group.group} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase text-slate-600 dark:text-slate-300">{group.label}</h4>
                      <span className="text-xs font-black text-slate-600 dark:text-slate-300">{group.items.length}</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {group.items.map((permission) => {
                        const checked = selectedPermissionSet.has(permission.code);
                        return (
                          <label
                            key={permission.code}
                            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                              checked
                                ? 'border-blue-300 bg-white text-slate-900 dark:border-blue-900 dark:bg-slate-900 dark:text-white'
                                : 'border-slate-200 bg-white/70 text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              data-testid={`role-permission-${permission.code}`}
                              checked={checked}
                              onChange={() => togglePermission(permission.code)}
                              className="mt-1 h-4 w-4 accent-blue-600"
                            />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 text-sm font-black">
                                {permission.label || permission.code}
                                {isHighRiskPermission(permission) && (
                                  <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                    {text.highRisk}
                                  </span>
                                )}
                                {checked && <CheckCircle2 size={14} className="text-blue-600" />}
                              </span>
                              <span className="mt-1 block break-all text-xs font-black text-slate-600 dark:text-slate-300">{permission.code}</span>
                              {permission.description && <span className="mt-1 block text-xs font-bold text-slate-600 dark:text-slate-300">{permission.description}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {review && (
            <div data-testid="role-change-review" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <h3 className="font-black">{review.title}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 font-bold">
                {review.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <p className="mt-3 font-bold">请确认这些变更符合员工职责，且不会扩大不必要的数据范围。</p>
            </div>
          )}

          <div className="sticky bottom-4 z-10 flex flex-wrap justify-end gap-3">
            {review && (
              <button
                type="button"
                data-testid="role-review-cancel"
                onClick={() => setReview(null)}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {text.cancelReview}
              </button>
            )}
            <button
              type="button"
              data-testid="role-save"
              onClick={() => review ? void confirmSaveRole() : requestReview()}
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={18} className="mr-2" />
              {saving ? text.saving : (review ? text.confirm : text.review)}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RoleManagementPanel;

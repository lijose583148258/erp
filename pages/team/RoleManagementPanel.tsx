import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LockKeyhole, Plus, Save, Search, ShieldCheck } from 'lucide-react';
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

interface RoleManagementPanelProps {
  roles: AuthRole[];
  onRolesChanged: () => void | Promise<void>;
}

const panelInputClass = 'rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition-all focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50';

const dataScopeOptions: Array<{ code: DataScopeCode; zh: string; en: string; vi: string }> = [
  { code: 'all', zh: '全公司数据', en: 'All company data', vi: 'Toàn bộ dữ liệu' },
  { code: 'own_customers', zh: '仅本人客户', en: 'Own customers only', vi: 'Chỉ khách hàng của mình' },
  { code: 'team_customers', zh: '团队客户', en: 'Team customers', vi: 'Khách hàng nhóm' },
  { code: 'finance_visible', zh: '可见财务数据', en: 'Finance visible', vi: 'Xem dữ liệu tài chính' },
  { code: 'warehouse_visible', zh: '可见仓储数据', en: 'Warehouse visible', vi: 'Xem dữ liệu kho' },
  { code: 'procurement_visible', zh: '可见采购数据', en: 'Procurement visible', vi: 'Xem dữ liệu mua hàng' },
];

const copy = {
  zh: {
    title: '角色权限管理',
    subtitle: '自定义角色、勾选权限点、保存后立即影响登录与菜单可见性。',
    create: '新建自定义角色',
    system: '系统角色',
    custom: '自定义角色',
    active: '启用',
    inactive: '停用',
    readonly: '系统角色只读，避免误改基础权限。',
    code: '角色编码',
    name: '角色名称',
    description: '说明',
    scopes: '数据范围',
    permissions: '权限点',
    search: '搜索权限代码 / 名称',
    selected: '已选',
    save: '保存角色',
    saving: '保存中...',
    codeHint: '仅限小写字母、数字、下划线、中横线或冒号，例如 sales_assistant。',
    emptyPermissions: '没有匹配的权限点',
    saved: '角色权限已保存并回读',
    validationName: '角色名称至少 2 个字符',
    validationCode: '角色编码格式不正确',
    validationPermissions: '至少勾选 1 个权限点',
    loadFail: '角色权限加载失败',
  },
  en: {
    title: 'Role & Permission Management',
    subtitle: 'Create custom roles, assign permissions, and make menu access effective after read-back.',
    create: 'New Custom Role',
    system: 'System Role',
    custom: 'Custom Role',
    active: 'Active',
    inactive: 'Disabled',
    readonly: 'System roles are read-only to protect baseline access.',
    code: 'Role Code',
    name: 'Role Name',
    description: 'Description',
    scopes: 'Data Scopes',
    permissions: 'Permissions',
    search: 'Search permission code / label',
    selected: 'Selected',
    save: 'Save Role',
    saving: 'Saving...',
    codeHint: 'Lowercase letters, numbers, underscore, dash, or colon. Example: sales_assistant.',
    emptyPermissions: 'No permissions matched',
    saved: 'Role permissions saved and read back',
    validationName: 'Role name needs at least 2 characters',
    validationCode: 'Role code format is invalid',
    validationPermissions: 'Select at least one permission',
    loadFail: 'Failed to load role permissions',
  },
  vi: {
    title: 'Quản lý vai trò và quyền',
    subtitle: 'Tạo vai trò tùy chỉnh, chọn quyền và áp dụng sau khi đọc lại dữ liệu.',
    create: 'Tạo vai trò tùy chỉnh',
    system: 'Vai trò hệ thống',
    custom: 'Vai trò tùy chỉnh',
    active: 'Đang bật',
    inactive: 'Đã tắt',
    readonly: 'Vai trò hệ thống chỉ đọc để bảo vệ quyền nền.',
    code: 'Mã vai trò',
    name: 'Tên vai trò',
    description: 'Mô tả',
    scopes: 'Phạm vi dữ liệu',
    permissions: 'Quyền',
    search: 'Tìm mã quyền / tên quyền',
    selected: 'Đã chọn',
    save: 'Lưu vai trò',
    saving: 'Đang lưu...',
    codeHint: 'Chỉ chữ thường, số, gạch dưới, gạch ngang hoặc dấu hai chấm. Ví dụ: sales_assistant.',
    emptyPermissions: 'Không tìm thấy quyền phù hợp',
    saved: 'Đã lưu và đọc lại quyền vai trò',
    validationName: 'Tên vai trò cần ít nhất 2 ký tự',
    validationCode: 'Mã vai trò không hợp lệ',
    validationPermissions: 'Chọn ít nhất một quyền',
    loadFail: 'Không tải được quyền vai trò',
  },
};

const groupLabels: Record<string, { zh: string; en: string; vi: string }> = {
  dashboard: { zh: '工作台', en: 'Dashboard', vi: 'Bảng điều khiển' },
  customers: { zh: '客户与主数据', en: 'Customers & master data', vi: 'Khách hàng & dữ liệu gốc' },
  orders: { zh: '销售订单', en: 'Sales orders', vi: 'Đơn bán hàng' },
  collections: { zh: '回款与催收', en: 'Collections', vi: 'Thu tiền' },
  finance: { zh: '财务经营', en: 'Finance', vi: 'Tài chính' },
  contracts: { zh: '合同', en: 'Contracts', vi: 'Hợp đồng' },
  barter: { zh: '货抵 / 换货', en: 'Barter settlement', vi: 'Đối trừ hàng hóa' },
  risk: { zh: '风控', en: 'Risk control', vi: 'Kiểm soát rủi ro' },
  samples: { zh: '样品', en: 'Samples', vi: 'Mẫu' },
  shipping: { zh: '出货物流', en: 'Shipping', vi: 'Vận chuyển' },
  team: { zh: '组织与权限', en: 'Team & access', vi: 'Nhóm & quyền' },
  assets: { zh: '资产', en: 'Assets', vi: 'Tài sản' },
  production: { zh: '生产', en: 'Production', vi: 'Sản xuất' },
  warehouse: { zh: '仓储', en: 'Warehouse', vi: 'Kho' },
  procurement: { zh: '采购', en: 'Procurement', vi: 'Mua hàng' },
  audit: { zh: '审计', en: 'Audit', vi: 'Kiểm toán' },
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

const RoleManagementPanel: React.FC<RoleManagementPanelProps> = ({ roles, onRolesChanged }) => {
  const { language, notify } = useAppContext();
  const text = copy[language] || copy.zh;
  const [permissions, setPermissions] = useState<AuthPermission[]>([]);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [selectedRoleCode, setSelectedRoleCode] = useState<string | null>(roles[0]?.code || null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>(() => roles[0] ? roleToDraft(roles[0]) : createEmptyDraft());
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [saving, setSaving] = useState(false);

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
    }
  }, [roles, selectedRoleCode, isCreating]);

  const activeRole = !isCreating ? roles.find((role) => role.code === selectedRoleCode) : undefined;
  const isReadOnly = Boolean(activeRole?.isSystem);
  const selectedPermissionSet = useMemo(() => new Set(draft.permissions), [draft.permissions]);

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
      label: groupLabels[group]?.[language] || group,
      items,
    }));
  }, [permissions, permissionSearch, language]);

  const startCreate = () => {
    setIsCreating(true);
    setSelectedRoleCode(null);
    setDraft(createEmptyDraft());
  };

  const selectRole = (role: AuthRole) => {
    setIsCreating(false);
    setSelectedRoleCode(role.code);
    setDraft(roleToDraft(role));
  };

  const toggleDataScope = (scope: DataScopeCode) => {
    setDraft((prev) => ({
      ...prev,
      dataScopes: prev.dataScopes.includes(scope)
        ? prev.dataScopes.filter((item) => item !== scope)
        : [...prev.dataScopes, scope],
    }));
  };

  const togglePermission = (permissionCode: string) => {
    if (isReadOnly) return;
    setDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permissionCode)
        ? prev.permissions.filter((item) => item !== permissionCode)
        : [...prev.permissions, permissionCode],
    }));
  };

  const saveRole = async () => {
    const normalizedCode = draft.code.trim().toLowerCase();
    if (draft.name.trim().length < 2) {
      notify('warning', text.validationName);
      return;
    }
    if (isCreating && !/^[a-z][a-z0-9_:-]{1,49}$/.test(normalizedCode)) {
      notify('warning', text.validationCode);
      return;
    }
    if (draft.permissions.length === 0) {
      notify('warning', text.validationPermissions);
      return;
    }
    if (isReadOnly) {
      notify('warning', text.readonly);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        code: isCreating ? normalizedCode : undefined,
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
      notify('success', text.saved);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : text.loadFail);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-testid="role-management-panel" className="bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl rounded-[40px] border border-white/60 dark:border-slate-800 shadow-[0_20px_70px_rgba(15,23,42,0.06)] overflow-hidden">
      <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="flex items-start gap-4">
          <div className="p-4 rounded-3xl bg-blue-600 text-white shadow-xl shadow-blue-500/20">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tighter text-slate-950 dark:text-white">{text.title}</h2>
            <p className="text-sm font-bold text-slate-400 mt-2 max-w-2xl">{text.subtitle}</p>
          </div>
        </div>
        <button
          data-testid="role-create-start"
          onClick={startCreate}
          className="inline-flex items-center justify-center rounded-[24px] bg-slate-950 px-6 py-4 text-sm font-black text-white shadow-xl transition-all hover:bg-blue-700 active:scale-95 dark:bg-white dark:text-slate-950"
        >
          <Plus size={18} className="mr-2" />
          {text.create}
        </button>
      </div>

      <div className="grid gap-0 lg:grid-cols-[320px_1fr]">
        <div className="border-b lg:border-b-0 lg:border-r border-slate-100 dark:border-slate-800 p-5 space-y-3 max-h-[720px] overflow-y-auto">
          {roles.map((role) => (
            <button
              key={role.code}
              data-testid={`role-card-${role.code}`}
              onClick={() => selectRole(role)}
              className={`w-full text-left rounded-[26px] p-5 border transition-all ${
                !isCreating && selectedRoleCode === role.code
                  ? 'border-blue-200 bg-blue-50 shadow-xl shadow-blue-100/60 dark:border-blue-900 dark:bg-blue-950/30 dark:shadow-none'
                  : 'border-slate-100 bg-slate-50 hover:bg-white hover:border-slate-200 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black text-slate-900 dark:text-white">{role.name}</p>
                  <p className="text-xs font-black text-slate-400 mt-1">{role.code}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-black tracking-wide ${
                  role.isActive
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                }`}>
                  {role.isActive ? text.active : text.inactive}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs font-black text-slate-400">
                <span>{role.isSystem ? text.system : text.custom}</span>
                <span>{role.permissions.length} {text.permissions}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="p-8 space-y-8">
          {isReadOnly && (
            <div className="flex items-center gap-3 rounded-[26px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
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
                onChange={(event) => setDraft((prev) => ({ ...prev, code: event.target.value }))}
                className={`${panelInputClass} disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-900`}
                placeholder="sales_assistant"
              />
              {isCreating && <span className="text-[11px] font-bold text-slate-400">{text.codeHint}</span>}
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{text.name}</span>
              <input
                data-testid="role-name-input"
                value={draft.name}
                disabled={isReadOnly}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                className={`${panelInputClass} disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-900`}
                placeholder={text.name}
              />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200 md:col-span-2">
              <span>{text.description}</span>
              <textarea
                data-testid="role-description-input"
                value={draft.description}
                disabled={isReadOnly}
                onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                className={`${panelInputClass} min-h-[92px] resize-y disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-900`}
                placeholder={text.description}
              />
            </label>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black tracking-wide text-slate-900 dark:text-white">{text.scopes}</h3>
              <label className="inline-flex items-center gap-3 rounded-full bg-slate-100 px-4 py-2 text-xs font-black text-slate-500 dark:bg-slate-950">
                <input
                  type="checkbox"
                  data-testid="role-active-toggle"
                  checked={draft.isActive}
                  disabled={isReadOnly}
                  onChange={(event) => setDraft((prev) => ({ ...prev, isActive: event.target.checked }))}
                  className="h-4 w-4 accent-blue-600"
                />
                {draft.isActive ? text.active : text.inactive}
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {dataScopeOptions.map((scope) => (
                <label key={scope.code} className={`flex items-center gap-3 rounded-[20px] border p-4 text-sm font-bold transition-all ${
                  draft.dataScopes.includes(scope.code)
                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200'
                    : 'border-slate-100 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950'
                }`}>
                  <input
                    type="checkbox"
                    data-testid={`role-scope-${scope.code}`}
                    checked={draft.dataScopes.includes(scope.code)}
                    disabled={isReadOnly}
                    onChange={() => toggleDataScope(scope.code)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  {scope[language] || scope.zh}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-black tracking-wide text-slate-900 dark:text-white">{text.permissions}</h3>
                <p className="text-xs font-bold text-slate-400 mt-1">{text.selected}: {draft.permissions.length}</p>
              </div>
              <label className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
                <Search size={16} className="text-slate-400" />
                <input
                  value={permissionSearch}
                  onChange={(event) => setPermissionSearch(event.target.value)}
                  className="bg-transparent outline-none text-sm font-bold text-slate-700 dark:text-slate-100"
                  placeholder={text.search}
                />
              </label>
            </div>

            {loadingPermissions ? (
              <div className="rounded-[28px] border border-dashed border-slate-200 p-8 text-center text-sm font-black text-slate-400 dark:border-slate-800">
                Loading...
              </div>
            ) : filteredPermissionGroups.length === 0 ? (
              <div className="rounded-[28px] border border-dashed border-slate-200 p-8 text-center text-sm font-black text-slate-400 dark:border-slate-800">
                {text.emptyPermissions}
              </div>
            ) : (
              <div className="space-y-5">
                {filteredPermissionGroups.map((group) => (
                  <div key={group.group} className="rounded-[30px] border border-slate-100 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/70">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{group.label}</h4>
                      <span className="text-[11px] font-black text-slate-400">{group.items.length}</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {group.items.map((permission) => {
                        const checked = selectedPermissionSet.has(permission.code);
                        return (
                          <label
                            key={permission.code}
                            className={`flex cursor-pointer items-start gap-3 rounded-[20px] border p-4 transition-all ${
                              checked
                                ? 'border-blue-200 bg-white text-slate-900 shadow-sm dark:border-blue-900 dark:bg-slate-900 dark:text-white'
                                : 'border-transparent bg-white/60 text-slate-500 hover:border-slate-200 dark:bg-slate-900/60'
                            } ${isReadOnly ? 'cursor-not-allowed opacity-80' : ''}`}
                          >
                            <input
                              type="checkbox"
                              data-testid={`role-permission-${permission.code}`}
                              checked={checked}
                              disabled={isReadOnly}
                              onChange={() => togglePermission(permission.code)}
                              className="mt-1 h-4 w-4 accent-blue-600"
                            />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 font-black text-sm">
                                {permission.label || permission.code}
                                {checked && <CheckCircle2 size={14} className="text-blue-600" />}
                              </span>
                              <span className="mt-1 block text-[11px] font-black text-slate-400 break-all">{permission.code}</span>
                              {permission.description && <span className="mt-1 block text-xs font-bold text-slate-400">{permission.description}</span>}
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

          <div className="sticky bottom-4 z-10 flex justify-end">
            <button
              data-testid="role-save"
              onClick={() => void saveRole()}
              disabled={saving || isReadOnly}
              className="inline-flex items-center justify-center rounded-[24px] bg-blue-600 px-7 py-4 text-sm font-black text-white shadow-2xl shadow-blue-500/25 transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={18} className="mr-2" />
              {saving ? text.saving : text.save}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RoleManagementPanel;

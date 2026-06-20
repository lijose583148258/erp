import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Power, PowerOff, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';
import DataTable, { Column } from '../components/DataTable';
import { useAppContext } from '../app/AppContext';
import { can } from '../app/permissions';
import { DocumentInputGuide } from '../components/ui/DocumentInputGuide';
import { TeamMember } from '../types';
import roleService, { AuthRole } from '../services/role.service';
import teamService from '../services/team.service';
import RoleManagementPanel from './team/RoleManagementPanel';

const inputClass = 'rounded-[12px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

const fallbackRoles = (t: Record<string, any>): AuthRole[] => [
  { id: 0, code: 'sales', name: t.roleSales || '销售', description: null, isSystem: true, isActive: true, dataScopes: ['own_customers'], permissions: ['dashboard.read', 'customers.read', 'orders.read'], createdAt: '', updatedAt: '' },
  { id: 0, code: 'manager', name: t.roleManager || '经理', description: null, isSystem: true, isActive: true, dataScopes: ['team_customers'], permissions: ['dashboard.read', 'customers.read', 'orders.read', 'team.read'], createdAt: '', updatedAt: '' },
  { id: 0, code: 'finance', name: t.roleFinance || '财务', description: null, isSystem: true, isActive: true, dataScopes: ['finance_visible'], permissions: ['dashboard.read', 'finance.read'], createdAt: '', updatedAt: '' },
  { id: 0, code: 'warehouse', name: t.roleWarehouse || '仓库', description: null, isSystem: true, isActive: true, dataScopes: ['warehouse_visible'], permissions: ['dashboard.read', 'warehouse.read'], createdAt: '', updatedAt: '' },
  { id: 0, code: 'admin', name: t.roleAdmin || '管理员', description: null, isSystem: true, isActive: true, dataScopes: ['all'], permissions: ['dashboard.read', 'team.read', 'team.write'], createdAt: '', updatedAt: '' },
];

const TeamManagement: React.FC = () => {
  const { t, currentUser, notify, formatPrice } = useAppContext();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [roleLoadStatus, setRoleLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loading, setLoading] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createdAccount, setCreatedAccount] = useState<{ username: string; role: string; segment: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'direct' | 'channel' | 'mixed'>('all');
  const [draft, setDraft] = useState({
    username: '',
    password: '',
    email: '',
    role: 'sales',
    segment: 'direct' as 'direct' | 'channel' | 'mixed',
  });

  const canManageTeam = can(currentUser, 'team.write');
  const canManageRoles = can(currentUser, 'authorization.roles.manage');
  const builtInRoles = useMemo(() => fallbackRoles(t), [t]);
  const roleOptions = useMemo(() => {
    const source = canManageRoles ? roles : builtInRoles;
    return source.filter(role => role.isActive && (canManageRoles || role.code === 'sales'));
  }, [builtInRoles, canManageRoles, roles]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await teamService.getAll());
    } catch (error) {
      notify('error', error instanceof Error ? error.message : (t.loadDataFail || '团队成员加载失败'));
    } finally {
      setLoading(false);
    }
  }, [notify, t.loadDataFail]);

  const loadRoles = useCallback(async () => {
    if (!canManageRoles) {
      setRoles([]);
      setRoleLoadStatus('idle');
      return;
    }
    setRoleLoadStatus('loading');
    setRolesLoading(true);
    try {
      const loadedRoles = await roleService.listRoles();
      if (loadedRoles.length === 0) throw new Error('角色列表为空，请重试');
      setRoles(loadedRoles);
      setRoleLoadStatus('ready');
    } catch (error) {
      setRoles([]);
      setRoleLoadStatus('error');
      notify('error', error instanceof Error ? error.message : (t.loadDataFail || '角色加载失败'));
    } finally {
      setRolesLoading(false);
    }
  }, [canManageRoles, notify, t.loadDataFail]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    if (roleOptions.length && !roleOptions.some(role => role.code === draft.role)) {
      setDraft(prev => ({ ...prev, role: roleOptions[0].code }));
    }
  }, [draft.role, roleOptions]);

  const filteredMembers = useMemo(() => members.filter(member => filter === 'all' || member.type === filter), [filter, members]);
  const totalPerformance = members.reduce((sum, member) => sum + member.performance, 0);

  const columns: Column<TeamMember>[] = [
    {
      header: t.memberEntity || '成员',
      key: 'name',
      accessor: (row) => (
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-[12px] font-black text-white ${row.type === 'direct' ? 'bg-blue-600' : row.type === 'channel' ? 'bg-emerald-600' : 'bg-violet-600'}`}>
            {row.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900 dark:text-white">{row.name}</div>
            <div className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">{row.role}</div>
          </div>
        </div>
      ),
    },
    { header: t.businessLine || '业务线', key: 'region', accessor: row => segmentLabel(row.type, t) },
    { header: t.performance || '业绩', key: 'performance', accessor: row => formatPrice(row.performance) },
    { header: t.totalCommission || '佣金', key: 'commission', accessor: row => formatPrice(row.totalCommission) },
    { header: t.region || '区域', key: 'regionName', accessor: row => row.region },
    {
      header: t.status || '状态',
      key: 'status',
      accessor: row => (
        <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-black ${row.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>
          {row.isActive ? '已启用' : '已停用'}
        </span>
      ),
    },
  ];

  const handleToggleActive = async (member: TeamMember) => {
    if (member.id === currentUser.id) {
      notify('warning', '不能停用当前正在登录的账号');
      return;
    }
    setUpdatingMemberId(member.id);
    try {
      const updated = await teamService.setActive(member.id, !member.isActive);
      setMembers(current => current.map(item => item.id === member.id ? { ...item, isActive: updated.isActive } : item));
      notify('success', updated.isActive ? '员工账号已启用' : '员工账号已停用');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '账号状态更新失败');
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const handleCreate = async () => {
    const username = draft.username.trim();
    const password = draft.password.trim();
    if (!username) return notify('warning', t.usernameRequired || '请输入登录账号');
    if (!/^[a-zA-Z0-9_]{2,50}$/.test(username)) return notify('warning', '账号只能使用 2-50 位字母、数字或下划线');
    if (password.length < 6) return notify('warning', t.passwordRequired || '请输入至少 6 位初始密码');
    if (roleOptions.length === 0) return notify('warning', '角色尚未加载完成，请重试后再创建账号');

    setSubmitting(true);
    try {
      const member = await teamService.create({
        username,
        password,
        email: draft.email.trim() || undefined,
        role: canManageRoles ? draft.role : 'sales',
        segment: draft.segment,
      });
      setMembers(prev => [member, ...prev]);
      const roleName = roleOptions.find(role => role.code === (canManageRoles ? draft.role : 'sales'))?.name || (canManageRoles ? draft.role : 'sales');
      setCreatedAccount({ username, role: roleName, segment: segmentLabel(draft.segment, t) });
      setDraft({ username: '', password: '', email: '', role: roleOptions[0]?.code || 'sales', segment: 'direct' });
      setShowCreateForm(false);
      notify('success', '账号已创建，请把登录账号和初始密码单独交付给员工');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : (t.memberCreateFail || '账号创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <DocumentInputGuide
        testId="team-permission-input-guide"
        eyebrow="组织权限 / 员工账号"
        title="先创建个人登录账号，再分配角色和业务范围"
        description="给员工使用时，不要共用 admin。管理员在这里创建员工账号，设置初始密码、角色和业务线；员工随后用自己的账号登录。敏感角色由具备授权权限的管理员分配，后续权限变化必须能审计。"
        tone="blue"
        steps={[
          { title: '创建账号', description: '填写登录名、初始密码、邮箱和业务线。', badge: '账号' },
          { title: '分配角色', description: '销售、仓库、财务、经理等角色决定菜单和 API 权限。', badge: '角色' },
          { title: '员工登录', description: '员工使用自己的账号和初始密码登录，不再共享管理员账号。', badge: '登录' },
          { title: '审计追踪', description: '账号创建、角色调整、停用都应进入审计日志。', badge: '审计' },
        ]}
        boundaries={[
          { title: '本页负责', items: ['员工账号', '角色', '权限点', '业务线', '账号启停'] },
          { title: '本页不负责', items: ['业务单据录入', '绕过审批', '共享管理员密码', 'AI 越权授权'] },
        ]}
        evidence={['账号可登录', '菜单按角色显示', '越权 API 被拒绝', '审计可查']}
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">{t.team || '用户、角色与权限'}</h1>
          <p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-300">用于给员工开设个人登录账号，并控制他们能看、能改、能审批的范围。</p>
        </div>
        {canManageTeam ? (
          <button data-testid="team-new-member" onClick={() => setShowCreateForm(current => !current)} className="inline-flex items-center rounded-[14px] bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700">
            <UserPlus size={18} className="mr-2" />
            {showCreateForm ? (t.cancel || '取消') : '新建员工账号'}
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={<UsersRound size={20} />} label="账号数" value={members.length} />
        <StatCard icon={<ShieldCheck size={20} />} label="可用角色" value={roleOptions.length} />
        <StatCard icon={<UsersRound size={20} />} label="团队业绩" value={formatPrice(totalPerformance)} />
      </div>

      {showCreateForm && canManageTeam ? (
        <section data-testid="team-create-form" className="rounded-[18px] border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">新建员工账号</h2>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">创建后即可用该账号登录</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t.username || '登录账号'}>
              <input data-testid="team-username-input" value={draft.username} onChange={(event) => setDraft(prev => ({ ...prev, username: event.target.value }))} className={inputClass} placeholder="例如 zhangsan" />
            </Field>
            <Field label={t.password || '初始密码'}>
              <input data-testid="team-password-input" type="password" value={draft.password} onChange={(event) => setDraft(prev => ({ ...prev, password: event.target.value }))} className={inputClass} placeholder="至少 6 位" />
            </Field>
            <Field label={t.email || '邮箱'}>
              <input data-testid="team-email-input" value={draft.email} onChange={(event) => setDraft(prev => ({ ...prev, email: event.target.value }))} className={inputClass} placeholder="可选" />
            </Field>
            <Field label={t.role || '角色'}>
              <select data-testid="team-member-role-select" value={draft.role} onChange={(event) => setDraft(prev => ({ ...prev, role: event.target.value }))} className={inputClass} disabled={rolesLoading || !canManageRoles}>
                {roleOptions.map(role => <option key={role.code} value={role.code}>{role.name} ({role.code})</option>)}
              </select>
              {!canManageRoles ? <span className="text-xs font-bold text-slate-600 dark:text-slate-300">当前账号只能创建销售账号；经理、财务、仓库、管理员角色需要超级管理员授权。</span> : null}
            </Field>
            <Field label={t.businessLine || '业务线'}>
              <select data-testid="team-segment-select" value={draft.segment} onChange={(event) => setDraft(prev => ({ ...prev, segment: event.target.value as typeof draft.segment }))} className={inputClass}>
                <option value="direct">{t.salesTeam || '直销'}</option>
                <option value="channel">{t.channelTeam || '渠道'}</option>
                <option value="mixed">{t.managerTeam || '混合/管理'}</option>
              </select>
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button onClick={() => setShowCreateForm(false)} className="rounded-[12px] border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-200">{t.cancel || '取消'}</button>
            <button data-testid="team-create-submit" onClick={() => void handleCreate()} disabled={submitting || roleOptions.length === 0} className="rounded-[12px] bg-blue-600 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
              {submitting ? (t.submitting || '提交中...') : '创建账号'}
            </button>
          </div>
        </section>
      ) : null}

      {createdAccount ? (
        <section data-testid="team-account-handoff" className="rounded-[18px] border border-emerald-200 bg-emerald-50 p-5 text-sm shadow-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-black text-emerald-950 dark:text-emerald-100">账号已创建，等待交付给员工</h2>
              <p className="mt-1 font-bold leading-6 text-emerald-900 dark:text-emerald-100">
                登录账号：<span className="font-black">{createdAccount.username}</span>；角色：{createdAccount.role}；业务线：{createdAccount.segment}。
              </p>
              <p className="mt-2 font-bold leading-6 text-emerald-900 dark:text-emerald-100">
                请通过公司内部安全渠道交付初始密码。员工首次登录后必须修改个人密码，不要把管理员账号或演示账号交给员工共用。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreatedAccount(null)}
              className="rounded-[12px] border border-emerald-300 bg-white px-4 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
            >
              已交付
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-[18px] border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'direct', 'channel', 'mixed'] as const).map(option => (
              <button key={option} onClick={() => setFilter(option)} className={`rounded-[12px] px-4 py-2 text-xs font-black ${filter === option ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                {option === 'all' ? (t.all || '全部') : segmentLabel(option, t)}
              </button>
            ))}
          </div>
          <button onClick={() => void loadMembers()} className="rounded-[12px] border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 dark:border-slate-700 dark:text-slate-200">
            {loading ? (t.loading || '加载中...') : '刷新账号'}
          </button>
        </div>
        <DataTable
          title={t.teamTitle || '团队成员'}
          columns={columns}
          data={filteredMembers}
          isLoading={loading}
          actions={canManageTeam ? member => (
            <button
              type="button"
              data-testid={`team-member-status-${member.id}`}
              onClick={(event) => {
                event.stopPropagation();
                void handleToggleActive(member);
              }}
              disabled={updatingMemberId === member.id || member.id === currentUser.id}
              title={member.id === currentUser.id ? '不能停用当前账号' : (member.isActive ? '停用账号' : '启用账号')}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40 ${member.isActive ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
            >
              {member.isActive ? <PowerOff size={14} /> : <Power size={14} />}
              {updatingMemberId === member.id ? '处理中' : (member.isActive ? '停用' : '启用')}
            </button>
          ) : undefined}
        />
      </section>

      {canManageRoles && roleLoadStatus === 'ready' && roles.length > 0 ? (
        <RoleManagementPanel roles={roles} onRolesChanged={loadRoles} />
      ) : canManageRoles ? (
        <section data-testid="role-management-unavailable" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-black text-slate-900 dark:text-white">角色权限管理</h2>
          <p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-300">
            {roleLoadStatus === 'error' ? '角色数据加载失败。为避免误覆盖权限，编辑和保存已停用。' : '正在加载真实角色权限，完成前不能编辑或保存。'}
          </p>
          {roleLoadStatus === 'error' ? (
            <button
              type="button"
              data-testid="role-load-retry"
              onClick={() => void loadRoles()}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
            >
              重新加载
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

const segmentLabel = (value: string, t: Record<string, any>) => {
  if (value === 'direct') return t.salesTeam || '直销';
  if (value === 'channel') return t.channelTeam || '渠道';
  if (value === 'mixed') return t.managerTeam || '混合/管理';
  return value;
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">{label}{children}</label>
);

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) => (
  <div className="rounded-[18px] border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[12px] bg-blue-600 text-white">{icon}</div>
    <div className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</div>
    <div className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{value}</div>
  </div>
);

export default TeamManagement;

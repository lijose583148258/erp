import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, Clock, Coins, PieChart, UserPlus } from 'lucide-react';
import { BarChart, Bar, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DataTable, { Column } from '../components/DataTable';
import { useAppContext } from '../app/AppContext';
import { can } from '../app/permissions';
import { TeamMember } from '../types';
import { dashboardService } from '../services/dashboard.service';
import roleService, { AuthRole } from '../services/role.service';
import teamService from '../services/team.service';
import RoleManagementPanel from './team/RoleManagementPanel';

const inputClass = 'rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:bg-slate-950 dark:text-white';

const TeamManagement: React.FC = () => {
  const { t, theme, formatPrice, currentUser, notify } = useAppContext();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [filter, setFilter] = useState<'all' | 'direct' | 'channel' | 'mixed'>('all');
  const [pendingCommCount, setPendingCommCount] = useState(0);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [chartBox, setChartBox] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState({
    username: '',
    password: '',
    email: '',
    role: 'sales',
    segment: 'direct' as 'direct' | 'channel' | 'mixed',
  });

  const canManageTeam = can(currentUser, 'team.write');
  const canViewFinancials = can(currentUser, 'finance.read') || currentUser.role === 'admin' || currentUser.role === 'manager';

  const fallbackRoleOptions = useMemo<AuthRole[]>(() => [
    {
      id: 0,
      code: 'sales',
      name: t.roleSales,
      description: null,
      isSystem: true,
      isActive: true,
      dataScopes: ['own_customers'],
      permissions: ['dashboard.read', 'customers.read', 'orders.read'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 0,
      code: 'manager',
      name: t.roleManager,
      description: null,
      isSystem: true,
      isActive: true,
      dataScopes: ['team_customers'],
      permissions: ['dashboard.read', 'customers.read', 'orders.read', 'team.read'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 0,
      code: 'finance',
      name: t.roleFinance,
      description: null,
      isSystem: true,
      isActive: true,
      dataScopes: ['finance_visible'],
      permissions: ['dashboard.read', 'finance.read'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 0,
      code: 'warehouse',
      name: t.roleWarehouse,
      description: null,
      isSystem: true,
      isActive: true,
      dataScopes: ['warehouse_visible'],
      permissions: ['dashboard.read', 'warehouse.read'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 0,
      code: 'admin',
      name: t.roleAdmin,
      description: null,
      isSystem: true,
      isActive: true,
      dataScopes: ['all'],
      permissions: ['dashboard.read', 'team.read', 'team.write'],
      createdAt: '',
      updatedAt: '',
    },
  ], [t.roleAdmin, t.roleFinance, t.roleManager, t.roleSales, t.roleWarehouse]);

  const roleOptions = useMemo(() => {
    const source = roles.length > 0 ? roles : fallbackRoleOptions;
    return source.filter(role => role.isActive);
  }, [roles, fallbackRoleOptions]);

  const refreshRoles = async () => {
    setRolesLoading(true);
    try {
      setRoles(await roleService.listRoles());
    } catch (error) {
      notify('error', error instanceof Error ? error.message : t.loadDataFail);
    } finally {
      setRolesLoading(false);
    }
  };

  useEffect(() => {
    teamService.getAll().then(setMembers);
    dashboardService.getStats().then(stats => {
      setPendingCommCount(stats.overview.pendingCommissions || 0);
    });
  }, []);

  useEffect(() => {
    if (!canManageTeam) {
      setRoles([]);
      setShowCreateForm(false);
      return;
    }

    let mounted = true;
    setRolesLoading(true);
    roleService.listRoles()
      .then(nextRoles => {
        if (mounted) setRoles(nextRoles);
      })
      .catch(error => notify('error', error instanceof Error ? error.message : t.loadDataFail))
      .finally(() => {
        if (mounted) setRolesLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [canManageTeam, notify, t.loadDataFail]);

  useEffect(() => {
    if (roleOptions.length > 0 && !roleOptions.some(role => role.code === draft.role)) {
      setDraft(prev => ({ ...prev, role: roleOptions[0].code }));
    }
  }, [draft.role, roleOptions]);

  useEffect(() => {
    if (currentUser.role === 'manager' && currentUser.segment === 'direct') {
      setFilter('direct');
    } else if (currentUser.role === 'manager' && currentUser.segment === 'channel') {
      setFilter('channel');
    } else {
      setFilter('all');
    }
  }, [currentUser]);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setChartBox({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    };

    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const filteredMembers = useMemo(() =>
    members.filter(member => {
      if (filter === 'all') return true;
      return member.type === filter;
    }),
    [members, filter]
  );

  const stats = useMemo(() => {
    const totalPerf = members.reduce((sum, member) => sum + member.performance, 0);
    const totalComm = members.reduce((sum, member) => sum + member.totalCommission, 0);
    const directComm = members.filter(member => member.type === 'direct').reduce((sum, member) => sum + member.totalCommission, 0);
    const channelComm = members.filter(member => member.type === 'channel').reduce((sum, member) => sum + member.totalCommission, 0);
    const mixedComm = members.filter(member => member.type === 'mixed').reduce((sum, member) => sum + member.totalCommission, 0);
    return { totalPerf, totalComm, directComm, channelComm, mixedComm };
  }, [members]);

  const chartData = useMemo(() =>
    filteredMembers.map(member => ({
      name: member.name,
      commission: canViewFinancials ? member.totalCommission : 0,
      color: member.type === 'direct' ? '#3b82f6' : member.type === 'channel' ? '#10b981' : '#8b5cf6',
    })),
    [filteredMembers, canViewFinancials]
  );

  const columns: Column<TeamMember>[] = [
    {
      header: t.memberEntity, key: 'name', accessor: (row) => (
        <div className="flex items-center space-x-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-white shadow-lg ${row.type === 'direct' ? 'bg-blue-600 shadow-blue-100 dark:shadow-none' : row.type === 'channel' ? 'bg-emerald-500 shadow-emerald-100 dark:shadow-none' : 'bg-violet-600 shadow-violet-100 dark:shadow-none'}`}>
            {row.name.charAt(0)}
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-slate-800 dark:text-white text-base">{row.name}</span>
            <span className="text-xs text-slate-400 font-black tracking-wide">{row.role}</span>
          </div>
        </div>
      ),
    },
    { header: t.region, key: 'region', accessor: (row) => row.region },
    { header: t.commRate, key: 'rate', accessor: (row) => canViewFinancials ? `${(row.commissionRate * 100).toFixed(1)}%` : t.hiddenData },
    { header: t.totalCommission, key: 'commission', accessor: (row) => canViewFinancials ? formatPrice(row.totalCommission) : t.hiddenData },
    { header: t.performance, key: 'revenue', accessor: (row) => formatPrice(row.performance) },
  ];

  const handleCreate = async () => {
    if (!draft.username.trim()) {
      notify('warning', t.usernameRequired);
      return;
    }
    if (!draft.password.trim()) {
      notify('warning', t.passwordRequired);
      return;
    }

    setSubmitting(true);
    try {
      const member = await teamService.create({
        username: draft.username.trim(),
        password: draft.password,
        email: draft.email.trim() || undefined,
        role: draft.role,
        segment: draft.segment,
      });
      setMembers(prev => [member, ...prev]);
      setDraft({
        username: '',
        password: '',
        email: '',
        role: 'sales',
        segment: 'direct',
      });
      setShowCreateForm(false);
      notify('success', t.memberCreated);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : t.memberCreateFail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter leading-none">{t.team}</h1>
          <p className="text-slate-400 font-bold text-xs tracking-wide mt-3">{t.teamSub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(currentUser.role === 'admin' || (currentUser.role === 'manager' && (!currentUser.segment || currentUser.segment === 'mixed'))) && (
            <div className="bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-wrap gap-2 shadow-sm">
              {(['all', 'direct', 'channel', 'mixed'] as const).map(option => (
                <button
                  key={option}
                  onClick={() => setFilter(option)}
                  className={`px-6 py-3 rounded-xl text-xs font-black tracking-wide transition-all ${
                    filter === option
                      ? option === 'all'
                        ? 'bg-slate-900 dark:bg-slate-700 text-white shadow-xl'
                        : option === 'direct'
                          ? 'bg-blue-600 text-white shadow-xl shadow-blue-100 dark:shadow-none'
                          : option === 'channel'
                            ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-100 dark:shadow-none'
                            : 'bg-violet-600 text-white shadow-xl shadow-violet-100 dark:shadow-none'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {option === 'all' ? t.all : option === 'direct' ? t.salesTeam : option === 'channel' ? t.channelTeam : t.managerTeam}
                </button>
              ))}
            </div>
          )}
          {canManageTeam && (
            <button data-testid="team-new-member" onClick={() => setShowCreateForm(current => !current)} className="flex items-center px-8 py-4 bg-blue-600 text-white rounded-[28px] font-black text-sm shadow-xl hover:bg-blue-700 transition-all active:scale-95">
              <UserPlus size={18} className="mr-3" />
              {t.newMember}
            </button>
          )}
        </div>
      </div>

      {showCreateForm && canManageTeam && (
        <div data-testid="team-create-form" className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 rounded-[36px] border border-white/50 dark:border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.03)] space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white">{t.newMember}</h2>
            </div>
            <button onClick={() => setShowCreateForm(false)} className="rounded-[18px] border border-slate-200 px-4 py-2 text-xs font-black text-slate-500">{t.cancel}</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.username}</span>
              <input data-testid="team-username-input" value={draft.username} onChange={(e) => setDraft(prev => ({ ...prev, username: e.target.value }))} className={inputClass} placeholder={t.phUsername} />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.password}</span>
              <input data-testid="team-password-input" type="password" value={draft.password} onChange={(e) => setDraft(prev => ({ ...prev, password: e.target.value }))} className={inputClass} placeholder={t.phPassword} />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.email}</span>
              <input data-testid="team-email-input" value={draft.email} onChange={(e) => setDraft(prev => ({ ...prev, email: e.target.value }))} className={inputClass} placeholder={t.phNote} />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.role}</span>
              <select data-testid="team-member-role-select" value={draft.role} onChange={(e) => setDraft(prev => ({ ...prev, role: e.target.value }))} className={inputClass} disabled={rolesLoading}>
                {roleOptions.map(role => (
                  <option key={role.code} value={role.code}>
                    {role.name} ({role.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200 md:col-span-2">
              <span>{t.businessLine}</span>
              <select data-testid="team-segment-select" value={draft.segment} onChange={(e) => setDraft(prev => ({ ...prev, segment: e.target.value as typeof draft.segment }))} className={inputClass}>
                <option value="direct">{t.salesTeam}</option>
                <option value="channel">{t.channelTeam}</option>
                <option value="mixed">{t.managerTeam}</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowCreateForm(false)} className="rounded-[18px] border border-slate-200 px-5 py-3 text-sm font-black text-slate-500">{t.cancel}</button>
            <button data-testid="team-create-submit" onClick={() => void handleCreate()} disabled={submitting} className="rounded-[18px] bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-xl shadow-blue-500/25 disabled:opacity-60">
              {submitting ? t.submitting : t.newMember}
            </button>
          </div>
        </div>
      )}

      {canManageTeam && (
        <RoleManagementPanel roles={roles.length > 0 ? roles : fallbackRoleOptions} onRolesChanged={refreshRoles} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-sm relative group overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 dark:bg-blue-900/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150 duration-700"></div>
          <div className="relative z-10">
            <div className="p-4 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-100 dark:shadow-none w-fit mb-6"><Coins size={24} /></div>
            <p className="text-xs font-black text-slate-400 tracking-wide mb-1">{t.totalCommission}</p>
            <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter italic">{canViewFinancials ? formatPrice(stats.totalComm) : t.hiddenData}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="p-4 bg-amber-500 text-white rounded-2xl shadow-xl shadow-amber-100 dark:shadow-none w-fit mb-6"><Briefcase size={24} /></div>
          <p className="text-xs font-black text-slate-400 tracking-wide mb-1">{t.performance}</p>
          <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter italic">{formatPrice(stats.totalPerf)}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between lg:col-span-2">
          <div>
            <div className="p-4 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-2xl w-fit mb-4"><Clock size={24} /></div>
            <p className="text-xs font-black text-slate-400 tracking-wide mb-1">{t.commPending}</p>
            <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter italic">{pendingCommCount} <span className="text-sm font-bold opacity-30">{t.records}</span></p>
          </div>
          <button onClick={() => { window.location.hash = '#orders'; }} className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs tracking-wide hover:bg-black transition-all">{t.reviewAll}</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <DataTable title={t.teamTitle} columns={columns} data={filteredMembers} />
        </div>
        <div className="bg-white dark:bg-slate-900 p-10 rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-10">
            <h3 className="font-black text-slate-900 dark:text-white flex items-center tracking-tight">
              <PieChart size={20} className="mr-3 text-blue-600" />
              {t.commissionAnalysis}
            </h3>
          </div>
          <div ref={chartWrapRef} className="h-[300px] w-full mb-8 min-w-0">
            {canViewFinancials ? (
              chartBox.width > 0 && chartBox.height > 0 ? (
                <ResponsiveContainer width={chartBox.width} height={chartBox.height} minWidth={0} minHeight={0}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 700 }} width={100} />
                    <Tooltip
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ borderRadius: '16px', border: 'none', backgroundColor: '#0f172a', color: '#fff' }}
                      formatter={(value: number) => [formatPrice(value), '']}
                    />
                    <Bar dataKey="commission" radius={[0, 4, 4, 0]} barSize={20}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 font-bold text-xs">
                  {t.loading}
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400 font-black text-xs tracking-wide bg-slate-50 dark:bg-slate-800 rounded-3xl">
                {t.permissionDenied}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamManagement;

import api from '../utils/api';
import { TeamMember } from '../types';

export interface CreateTeamMemberInput {
    username: string;
    password: string;
    email?: string;
    role: string;
    segment?: 'direct' | 'channel' | 'mixed';
}

interface ApiTeamMember {
    id: number | string;
    username?: string;
    name?: string;
    isActive?: boolean;
    role?: TeamMember['role'];
    segment?: 'direct' | 'channel' | 'mixed' | null;
    region?: string | null;
    totalAmount?: number | string | null;
    customerCount?: number | string | null;
    statistics?: {
        totalRevenue?: number | string | null;
        totalCommission?: number | string | null;
        customerCount?: number | string | null;
    } | null;
}

const toNumber = (value: number | string | null | undefined) => Number(value || 0);

const mapTeamMember = (item: ApiTeamMember): TeamMember => ({
    id: String(item.id),
    name: item.username || item.name || 'Unknown',
    isActive: item.isActive !== false,
    role: item.role || 'sales',
    type: item.segment === 'channel' ? 'channel' : item.segment === 'mixed' ? 'mixed' : 'direct',
    region: item.region || 'Global',
    performance: toNumber(item.statistics?.totalRevenue ?? item.totalAmount),
    commissionRate: 0.03,
    totalCommission: toNumber(item.statistics?.totalCommission),
    customerCount: toNumber(item.statistics?.customerCount ?? item.customerCount),
});

export const teamService = {
    /**
     * 获取团队成员列表
     */
    async getAll(): Promise<TeamMember[]> {
        const response = await api.get<any, { success: boolean; data: ApiTeamMember[] }>('/team');
        const data = response.data || [];
        return data.map(mapTeamMember);
    },

    /**
     * 创建团队成员（仅管理员）
     */
    async create(member: CreateTeamMemberInput): Promise<TeamMember> {
        const response = await api.post<any, { success: boolean; data: ApiTeamMember }>('/team', member);
        return mapTeamMember(response.data);
    },

    async setActive(id: string, isActive: boolean): Promise<TeamMember> {
        const response = await api.put<any, { success: boolean; data: ApiTeamMember }>(`/team/${id}`, { isActive });
        return mapTeamMember(response.data);
    },

};

export default teamService;

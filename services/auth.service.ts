import api from '../utils/api';
import { CurrentUser, UserRole } from '../types';

export interface LoginResponse {
    success: boolean;
    data: {
        token: string;
        user: {
            id: number;
            username: string;
            email: string;
            role: string;
            segment?: string | null;
            avatar?: string;
            permissions?: string[];
            dataScopes?: string[];
        };
    };
}

const resolveSegment = (role: UserRole, segment?: string | null, username?: string): CurrentUser['segment'] => {
    if (segment === 'direct' || segment === 'channel' || segment === 'mixed') {
        return segment;
    }

    const lowerUsername = username?.toLowerCase() || '';
    if (lowerUsername.includes('channel')) return 'channel';
    if (lowerUsername.includes('mixed')) return 'mixed';
    if (role === 'manager' || role === 'admin' || role === 'warehouse' || role === 'finance') {
        return 'mixed';
    }
    return 'direct';
};

export const authService = {
    async login(username: string, password: string): Promise<CurrentUser> {
        if (!username || !password) {
            throw new Error('请输入用户名和密码');
        }

        const response = await api.post<any, LoginResponse>('/auth/login', { username, password });
        const { token, user } = response.data;

        localStorage.setItem('token', token);

        const currentUser: CurrentUser = {
            id: String(user.id),
            name: user.username,
            role: user.role as UserRole,
            segment: resolveSegment(user.role as UserRole, user.segment, user.username),
            avatar: user.avatar || '',
            permissions: user.permissions || [],
            dataScopes: user.dataScopes || [],
        };

        localStorage.setItem('user', JSON.stringify(currentUser));
        return currentUser;
    },

    async register(username: string, password: string, email: string, role: string) {
        return api.post('/auth/register', { username, password, email, role });
    },

    /**
     * 退出登录
     */
    logout() {
        const token = localStorage.getItem('token');
        if (token) {
            void api.post('/auth/logout', {}, {
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => undefined);
        }
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    },

    /**
     * 获取当前用户信息（从本地存储或 API）
     */
    getCurrentUser(): CurrentUser | null {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            const user = JSON.parse(userStr) as CurrentUser;
            return user;
        }
        return null;
    },
};

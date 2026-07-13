import api from '../utils/api';
import { clearAuthStorage, safeStorage } from '../utils/browserStorage';
import { CurrentUser, UserRole } from '../types';

export interface LoginResponse {
    success: boolean;
    data: {
        token: string;
        refreshToken?: string;
        user: AuthUserPayload;
    };
}

export interface AuthUserPayload {
    id: number | string;
    username: string;
    email?: string | null;
    role: string;
    segment?: string | null;
    avatar?: string | null;
    mustChangePassword?: boolean;
    permissions?: string[];
    dataScopes?: string[];
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

const normalizeUser = (user: AuthUserPayload): CurrentUser => ({
    id: String(user.id),
    name: user.username,
    role: user.role as UserRole,
    segment: resolveSegment(user.role as UserRole, user.segment, user.username),
    avatar: user.avatar || '',
    mustChangePassword: Boolean(user.mustChangePassword),
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    dataScopes: Array.isArray(user.dataScopes) ? user.dataScopes : [],
});

const persistSession = (token: string, user: CurrentUser, refreshToken?: string) => {
    safeStorage.setItem('token', token);
    if (refreshToken) safeStorage.setItem('refreshToken', refreshToken);
    safeStorage.setJson('user', user);
};

export const authService = {
    async login(username: string, password: string, mfaCode?: string): Promise<CurrentUser> {
        if (!username || !password) {
            throw new Error('请输入用户名和密码');
        }

        clearAuthStorage();
        const response = await api.post<any, LoginResponse>('/auth/login', { username, password, mfaCode });
        const { token, refreshToken, user } = response.data;
        const currentUser = normalizeUser(user);
        persistSession(token, currentUser, refreshToken);
        return currentUser;
    },

    async register(username: string, password: string, email: string, role: string) {
        return api.post('/auth/register', { username, password, email, role });
    },

    async changePassword(oldPassword: string, newPassword: string) {
        return api.put('/auth/password', { oldPassword, newPassword });
    },

    async me(): Promise<CurrentUser> {
        const response = await api.get<any, { data: AuthUserPayload }>('/auth/me');
        const currentUser = normalizeUser(response.data);
        safeStorage.setJson('user', currentUser);
        return currentUser;
    },

    async refresh(): Promise<boolean> {
        const refreshToken = safeStorage.getItem('refreshToken');
        if (!refreshToken) return false;
        try {
            const response = await api.post<any, { data: { token: string; refreshToken?: string } }>('/auth/refresh', { refreshToken });
            safeStorage.setItem('token', response.data.token);
            if (response.data.refreshToken) safeStorage.setItem('refreshToken', response.data.refreshToken);
            return true;
        } catch {
            clearAuthStorage();
            return false;
        }
    },

    logout() {
        const token = safeStorage.getItem('token');
        const refreshToken = safeStorage.getItem('refreshToken');
        if (token) {
            void api.post('/auth/logout', { refreshToken }, {
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => undefined);
        }
        clearAuthStorage();
    },

    getCurrentUser(): CurrentUser | null {
        const token = safeStorage.getItem('token');
        if (!token) {
            clearAuthStorage();
            return null;
        }
        return safeStorage.getJson<CurrentUser>('user');
    },

    hasToken(): boolean {
        return Boolean(safeStorage.getItem('token'));
    },

    getToken(): string | null {
        return safeStorage.getItem('token');
    },
};

import axios, { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { reportClientIssue } from './clientIssue';

export type ApiRequestOptions = {
    signal?: AbortSignal;
};

export type ApiClientError = Error & {
    status?: number;
    issues?: unknown[];
    isCanceled?: boolean;
    isTimeout?: boolean;
};

export const isCanceledApiError = (error: unknown): boolean => {
    const candidate = error as ApiClientError & { code?: string; name?: string } | null | undefined;
    return Boolean(
        candidate?.isCanceled
        || candidate?.code === 'ERR_CANCELED'
        || candidate?.name === 'CanceledError'
        || axios.isCancel(error)
    );
};

const LOCAL_BROWSER_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const normalizeApiBaseUrl = (value: string) => value.replace(/\/+$/, '');

const resolveApiBaseUrl = () => {
    const explicitBaseUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_ABSOLUTE_URL;
    if (explicitBaseUrl) return normalizeApiBaseUrl(explicitBaseUrl);

    if (typeof window !== 'undefined') {
        const { protocol, hostname, port, origin } = window.location;
        if (port === '5001') {
            return `${origin}/api`;
        }
        if (LOCAL_BROWSER_HOSTS.has(hostname)) {
            return `${protocol}//${hostname}:5001/api`;
        }
        return `${origin}/api`;
    }

    return '/api';
};

const apiBaseUrl = resolveApiBaseUrl();
// Mock mode is intentionally disabled in the governed runtime. The old mock
// adapter masked stale-interface defects and has been isolated; local and
// packaged runs must exercise the real backend on port 5001.
const mockRequested = String(import.meta.env.VITE_USE_MOCK ?? 'false').toLowerCase() === 'true';
if (mockRequested && import.meta.env.DEV) {
    console.warn('[AilaoDa] VITE_USE_MOCK is ignored. Use the real backend on port 5001.');
}

const api = axios.create({
    baseURL: apiBaseUrl,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// 请求拦截器：自动注入 Token
api.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        (config as InternalAxiosRequestConfig & { __authToken?: string | null }).__authToken = token;
        return config;
    },
    (error) => Promise.reject(error)
);

// 响应拦截器：统一错误处理
api.interceptors.response.use(
    (response: AxiosResponse) => {
        const payload = response.data;
        if (payload && typeof payload === 'object' && 'data' in payload) {
            return payload;
        }
        return { data: payload };
    },
    (error) => {
        if (axios.isCancel(error) || error?.code === 'ERR_CANCELED') {
            const canceledError = new Error('请求已取消') as ApiClientError;
            canceledError.status = 0;
            canceledError.isCanceled = true;
            return Promise.reject(canceledError);
        }

        // 处理 401 未授权
        if (error.response && error.response.status === 401) {
            const requestToken = (error.config as InternalAxiosRequestConfig & { __authToken?: string | null } | undefined)?.__authToken;
            const currentToken = localStorage.getItem('token');
            const isCurrentAuthFailure = (Boolean(requestToken) && requestToken === currentToken)
                || (!requestToken && !currentToken);
            if (!isCurrentAuthFailure) {
                const message = error.response?.data?.message || error.message || '请求失败';
                const staleAuthError = new Error(message) as Error & { status?: number; issues?: unknown[] };
                staleAuthError.status = error.response?.status;
                staleAuthError.issues = error.response?.data?.issues;
                return Promise.reject(staleAuthError);
            }
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // 可以在这里直接重定向，或者交给上层组件处理
            window.location.href = '/';
        }

        // 提取错误信息，并保留后端结构化业务问题，供生产/库存等关键页面展示细节。
        let message = error.response?.data?.message || error.message || '请求失败';
        if (message === 'Network Error' || error.code === 'ERR_NETWORK') {
            message = '无法连接到服务器，请确认爱劳达后端服务已启动（端口 5001）';
        }
        const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(String(message));
        if (!isTimeout) {
            reportClientIssue('api-error', message);
        }

        const enrichedError = new Error(message) as ApiClientError;
        enrichedError.status = error.response?.status;
        enrichedError.issues = error.response?.data?.issues;
        enrichedError.isTimeout = isTimeout;
        return Promise.reject(enrichedError);
    }
);

export default api;

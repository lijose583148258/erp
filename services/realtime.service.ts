import { authService } from './auth.service';

export type RealtimeNotification = {
    type: string;
    title: string;
    message: string;
    resourceType: 'order' | 'payment' | 'system';
    resourceId?: string | number | null;
    severity?: 'info' | 'success' | 'warning' | 'error';
    occurredAt?: string;
};

type RealtimeHandlers = {
    onNotification: (event: RealtimeNotification) => void;
    onStatusChange?: (status: 'connected' | 'disconnected') => void;
};

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;

const resolveWebSocketUrl = (token: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/notifications?token=${encodeURIComponent(token)}`;
};

const clearReconnect = () => {
    if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
};

export const realtimeService = {
    connect(handlers: RealtimeHandlers) {
        if (!('WebSocket' in window)) return;
        const token = authService.getToken();
        if (!token) return;
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

        clearReconnect();
        socket = new WebSocket(resolveWebSocketUrl(token));
        socket.onopen = () => {
            reconnectAttempts = 0;
            handlers.onStatusChange?.('connected');
        };
        socket.onmessage = (message) => {
            try {
                handlers.onNotification(JSON.parse(String(message.data)) as RealtimeNotification);
            } catch {
                // Ignore malformed realtime frames.
            }
        };
        socket.onclose = () => {
            socket = null;
            handlers.onStatusChange?.('disconnected');
            if (!authService.hasToken()) return;
            const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
            reconnectAttempts += 1;
            reconnectTimer = window.setTimeout(() => this.connect(handlers), delay);
        };
        socket.onerror = () => {
            socket?.close();
        };
    },

    disconnect() {
        clearReconnect();
        reconnectAttempts = 0;
        socket?.close();
        socket = null;
    },
};

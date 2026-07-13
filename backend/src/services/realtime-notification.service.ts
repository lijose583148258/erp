import crypto from 'crypto';
import { IncomingMessage, Server } from 'http';
import { Socket } from 'net';
import { isTokenBlacklisted } from './auth-token-store.service';
import { logger } from '../utils/logger';
import { JwtPayload, verifyToken } from '../utils/jwt';
import { createRedisClient, ensureRedisConnected, isRedisConfigured } from '../infrastructure/redis-runtime';

export type RealtimeNotificationEvent = {
  type: 'order.created' | 'order.updated' | 'order.status_changed' | 'order.completed' | 'payment.submitted' | 'payment.verified';
  title: string;
  message: string;
  resourceType: 'order' | 'payment' | 'system';
  resourceId?: string | number | null;
  severity?: 'info' | 'success' | 'warning' | 'error';
  audience?: {
    roles?: string[];
    userIds?: number[];
  };
  occurredAt?: string;
};

type RealtimeClient = {
  id: string;
  socket: Socket;
  user: JwtPayload;
  connectedAt: number;
};

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Map<string, RealtimeClient>();
const instanceId = crypto.randomUUID();
const busChannel = String(process.env.REALTIME_REDIS_CHANNEL || 'ailaoda:realtime:notifications');
const configuredBusDriver = String(process.env.REALTIME_BUS_DRIVER || '').trim().toLowerCase();
const busDriver = configuredBusDriver === 'memory' || configuredBusDriver === 'redis'
  ? configuredBusDriver
  : isRedisConfigured() ? 'redis' : 'memory';
const publisher = busDriver === 'redis' ? createRedisClient('realtime-publisher') : null;
const subscriber = busDriver === 'redis' ? createRedisClient('realtime-subscriber') : null;
let busStartPromise: Promise<void> | null = null;
let busLastError: string | null = null;

if (process.env.NODE_ENV === 'production' && process.env.AILAODA_DEPLOYMENT_MODE === 'saas' && busDriver !== 'redis') {
  throw new Error('SaaS deployment requires REALTIME_BUS_DRIVER=redis and a direct or Sentinel Redis configuration.');
}

const encodeFrame = (payload: string): Buffer => {
  const body = Buffer.from(payload, 'utf8');
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  if (body.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([header, body]);
};

const closeSocket = (socket: Socket, code = 1008, reason = 'Unauthorized') => {
  const reasonBuffer = Buffer.from(reason, 'utf8');
  const payload = Buffer.alloc(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  socket.write(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
  socket.end();
};

const authenticateUpgrade = async (request: IncomingMessage): Promise<JwtPayload | null> => {
  const host = request.headers.host || 'localhost';
  const url = new URL(request.url || '/', `http://${host}`);
  const token = url.searchParams.get('token');
  if (!token || await isTokenBlacklisted(token)) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
};

const sendToClient = (client: RealtimeClient, event: RealtimeNotificationEvent) => {
  client.socket.write(encodeFrame(JSON.stringify({
    ...event,
    occurredAt: event.occurredAt || new Date().toISOString(),
  })));
};

const isAudienceMatch = (client: RealtimeClient, event: RealtimeNotificationEvent) => {
  const roles = event.audience?.roles;
  const userIds = event.audience?.userIds;
  return (!roles?.length || roles.includes(client.user.role)) &&
    (!userIds?.length || userIds.includes(client.user.userId));
};

const deliverLocalNotification = (event: RealtimeNotificationEvent) => {
  let delivered = 0;
  for (const client of clients.values()) {
    if (!isAudienceMatch(client, event)) continue;
    try {
      sendToClient(client, event);
      delivered += 1;
    } catch (error) {
      logger.warn('Realtime notification delivery failed', error);
      clients.delete(client.id);
    }
  }
  return delivered;
};

const startRealtimeBus = async () => {
  if (!publisher || !subscriber) return;
  if (busStartPromise) return busStartPromise;

  busStartPromise = (async () => {
    await Promise.all([ensureRedisConnected(publisher), ensureRedisConnected(subscriber)]);
    subscriber.on('message', (channel, payload) => {
      if (channel !== busChannel) return;
      try {
        const envelope = JSON.parse(payload) as { origin?: string; event?: RealtimeNotificationEvent };
        if (!envelope.event || envelope.origin === instanceId) return;
        deliverLocalNotification(envelope.event);
      } catch (error) {
        logger.warn('Realtime Redis event could not be decoded', error);
      }
    });
    await subscriber.subscribe(busChannel);
    busLastError = null;
  })().catch((error) => {
    busLastError = error instanceof Error ? error.message : String(error);
    busStartPromise = null;
    throw error;
  });
  return busStartPromise;
};

const acceptUpgrade = (request: IncomingMessage, socket: Socket, user: JwtPayload) => {
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'));

  const id = crypto.randomUUID();
  const client: RealtimeClient = { id, socket, user, connectedAt: Date.now() };
  clients.set(id, client);
  socket.on('close', () => clients.delete(id));
  socket.on('error', () => clients.delete(id));
  socket.on('data', (chunk) => {
    if ((chunk[0] & 0x0f) === 0x8) {
      clients.delete(id);
      socket.end();
    }
  });
};

export const attachRealtimeNotifications = (server: Server) => {
  void startRealtimeBus().catch((error) => logger.error('Realtime Redis bus unavailable', error));
  server.on('upgrade', (request, socket) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname !== '/ws/notifications') return;
    const tcpSocket = socket as Socket;

    void authenticateUpgrade(request)
      .then((user) => {
        if (!user) {
          closeSocket(tcpSocket);
          return;
        }
        acceptUpgrade(request, tcpSocket, user);
      })
      .catch((error) => {
        logger.warn('Realtime authentication failed', error);
        closeSocket(tcpSocket, 1013, 'Authentication service unavailable');
      });
  });
};

export const publishRealtimeNotification = (event: RealtimeNotificationEvent): number => {
  const delivered = deliverLocalNotification(event);
  if (publisher) {
    void startRealtimeBus()
      .then(() => publisher.publish(busChannel, JSON.stringify({ origin: instanceId, event })))
      .catch((error) => {
        busLastError = error instanceof Error ? error.message : String(error);
        logger.warn('Realtime Redis publish failed', error);
      });
  }
  return delivered;
};

export const getRealtimeNotificationStatus = () => ({
  clients: clients.size,
  busDriver,
  busReady: publisher ? publisher.status === 'ready' && subscriber?.status === 'ready' : true,
  busLastError,
});

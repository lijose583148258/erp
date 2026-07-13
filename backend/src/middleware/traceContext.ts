import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

export type TraceContext = {
  traceId: string;
  spanId: string;
  traceparent: string;
  requestId: string;
  sampled: boolean;
  source: 'incoming' | 'generated';
};

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

const randomHex = (bytes: number) => crypto.randomBytes(bytes).toString('hex');

const isNonZeroHex = (value: string) => !/^0+$/.test(value);

export const parseTraceparent = (value: unknown): TraceContext | null => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(TRACEPARENT_RE);
  if (!match) return null;
  const traceId = match[1].toLowerCase();
  const parentSpanId = match[2].toLowerCase();
  const flags = match[3].toLowerCase();
  if (!isNonZeroHex(traceId) || !isNonZeroHex(parentSpanId)) return null;
  const spanId = randomHex(8);
  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-${flags}`,
    requestId: traceId,
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
    source: 'incoming',
  };
};

export const createTraceContext = (incomingTraceparent?: unknown): TraceContext => {
  const parsed = parseTraceparent(incomingTraceparent);
  if (parsed) return parsed;
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-01`,
    requestId: traceId,
    sampled: true,
    source: 'generated',
  };
};

export const getTraceContext = (req: Request): TraceContext | undefined =>
  (req as Request & { traceContext?: TraceContext }).traceContext;

export const traceContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const traceContext = createTraceContext(req.get('traceparent'));
  (req as Request & { traceContext?: TraceContext }).traceContext = traceContext;
  res.setHeader('traceparent', traceContext.traceparent);
  res.setHeader('X-Request-Id', traceContext.requestId);
  next();
};

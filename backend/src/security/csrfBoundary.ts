import { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_COOKIE_PATTERN = /(?:^|;\s*)(?:token|access_token|refresh_token|refreshToken|jwt|session|connect\.sid)=/i;

type CsrfBoundaryOptions = {
  allowedOrigins: string[];
};

const normalizeOrigin = (origin: string) => origin.replace(/\/+$/, '');

export const createCsrfBoundary = ({ allowedOrigins }: CsrfBoundaryOptions) => {
  const allowed = new Set(allowedOrigins.map(normalizeOrigin));

  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-CSRF-Protection-Mode', 'bearer-token-origin-boundary');

    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    if (!req.path.startsWith('/api')) {
      return next();
    }

    const origin = req.get('origin');
    if (origin && !allowed.has(normalizeOrigin(origin))) {
      return res.status(403).json({
        success: false,
        message: 'Cross-origin write request rejected.',
        errorCode: 'CSRF_ORIGIN_REJECTED',
      });
    }

    const authHeader = req.get('authorization') || '';
    const hasBearerAuth = authHeader.startsWith('Bearer ');
    const cookie = req.get('cookie') || '';
    if (!hasBearerAuth && TOKEN_COOKIE_PATTERN.test(cookie)) {
      return res.status(403).json({
        success: false,
        message: 'Cookie-based API authentication is not enabled. Use Authorization: Bearer.',
        errorCode: 'CSRF_COOKIE_AUTH_REJECTED',
      });
    }

    return next();
  };
};

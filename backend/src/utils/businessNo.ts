import { randomUUID } from 'crypto';

export const buildBusinessNo = (prefix: string) => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  return `${prefix}-${Date.now()}-${suffix}`;
};

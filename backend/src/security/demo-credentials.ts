import { demoUsers } from '../database/seed-fixtures';

const truthy = (value?: string) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const defaultCredentials = new Map<string, string>(demoUsers.map(user => [user.username, user.password]));

/** Production always rejects published demo passwords before issuing a token. */
export const isReleaseDemoCredential = (username: string, password: string) =>
  (process.env.NODE_ENV === 'production' || truthy(process.env.AILAODA_BLOCK_DEMO_CREDENTIALS))
  && defaultCredentials.get(username) === password;

export const shouldBlockDemoCredentials = () =>
  process.env.NODE_ENV === 'production' || truthy(process.env.AILAODA_BLOCK_DEMO_CREDENTIALS);

import type { AuthRequest } from '../middleware/auth';
import {
  canUseOrderForBusinessWrite,
  canUseOrderForCollectionWrite,
} from './recordAccess';

const requestFor = (overrides: Partial<NonNullable<AuthRequest['user']>>) => ({
  user: {
    userId: 10,
    username: 'scope-test',
    role: 'manager',
    segment: 'direct',
    dataScopes: ['team_customers', 'finance_visible'],
    ...overrides,
  },
}) as AuthRequest;

const orderForSegment = (segment: string) => ({
  createdBy: 99,
  customer: {
    salespersonId: 99,
    poolState: 'private',
    segment,
  },
});

describe('order write data-scope separation', () => {
  it('keeps a segmented manager inside the customer segment for core order writes', () => {
    const req = requestFor({});

    expect(canUseOrderForBusinessWrite(req, orderForSegment('direct'))).toBe(true);
    expect(canUseOrderForBusinessWrite(req, orderForSegment('channel'))).toBe(false);
  });

  it('does not turn finance visibility into cross-segment collection write access for a segmented manager', () => {
    const req = requestFor({});

    expect(canUseOrderForCollectionWrite(req, orderForSegment('direct'))).toBe(true);
    expect(canUseOrderForCollectionWrite(req, orderForSegment('channel'))).toBe(false);
  });

  it('keeps finance and custom finance operators able to mutate collections without granting core order writes', () => {
    for (const role of ['finance', 'regional_finance_operator']) {
      const req = requestFor({ role, dataScopes: ['finance_visible'], segment: 'channel' });
      const directOrder = orderForSegment('direct');

      expect(canUseOrderForBusinessWrite(req, directOrder)).toBe(false);
      expect(canUseOrderForCollectionWrite(req, directOrder)).toBe(true);
    }
  });

  it('preserves explicit all-scope access for both write families', () => {
    const req = requestFor({ role: 'custom_admin', dataScopes: ['all'], segment: 'channel' });
    const directOrder = orderForSegment('direct');

    expect(canUseOrderForBusinessWrite(req, directOrder)).toBe(true);
    expect(canUseOrderForCollectionWrite(req, directOrder)).toBe(true);
  });
});

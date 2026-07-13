jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { MemoryAuthTokenStore } from './auth-token-store.service';

describe('MemoryAuthTokenStore', () => {
  it('consumes a refresh token exactly once', async () => {
    const store = new MemoryAuthTokenStore();
    const issued = await store.issueRefreshToken(12);

    expect(issued).not.toBeNull();
    await expect(store.consumeRefreshToken(issued!.refreshToken)).resolves.toEqual(expect.objectContaining({
      userId: 12,
      generation: 0,
    }));
    await expect(store.consumeRefreshToken(issued!.refreshToken)).resolves.toBeNull();
  });

  it('invalidates old refresh tokens when the user generation advances', async () => {
    const store = new MemoryAuthTokenStore();
    const issued = await store.issueRefreshToken(7);
    await store.revokeRefreshTokensForUser(7);

    await expect(store.consumeRefreshToken(issued!.refreshToken)).resolves.toBeNull();
    await expect(store.issueRefreshToken(7, 0)).resolves.toBeNull();
    await expect(store.issueRefreshToken(7, 1)).resolves.not.toBeNull();
  });

  it('tracks access-token revocation without storing the raw token as a key', async () => {
    const store = new MemoryAuthTokenStore();
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
    const token = `header.${payload}.signature`;

    await expect(store.isAccessTokenBlacklisted(token)).resolves.toBe(false);
    await store.blacklistAccessToken(token);
    await expect(store.isAccessTokenBlacklisted(token)).resolves.toBe(true);
  });
});

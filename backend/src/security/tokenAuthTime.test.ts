import { resolveTokenAuthAt } from './tokenAuthTime';

describe('token authentication timestamp', () => {
  it('uses the current clock when the user record is older', () => {
    expect(resolveTokenAuthAt(new Date(1_000), 2_000)).toBe(2_000);
  });

  it('uses the persisted user timestamp when the database clock is slightly ahead', () => {
    expect(resolveTokenAuthAt(new Date(2_002), 2_000)).toBe(2_002);
  });
});

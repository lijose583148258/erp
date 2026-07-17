export const resolveTokenAuthAt = (userUpdatedAt?: Date | null, now = Date.now()) =>
  Math.max(now, userUpdatedAt?.getTime() || 0);

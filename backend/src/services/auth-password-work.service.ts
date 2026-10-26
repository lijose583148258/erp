import bcrypt from 'bcryptjs';

const MAX_ACTIVE = 2;
const MAX_PENDING = 64;
let active = 0;
const pending: Array<() => void> = [];

export class PasswordWorkCapacityError extends Error {
  constructor() {
    super('Password processing capacity is temporarily full.');
    this.name = 'PasswordWorkCapacityError';
  }
}

async function runPasswordWork<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) {
    if (pending.length >= MAX_PENDING) throw new PasswordWorkCapacityError();
    await new Promise<void>(resolve => pending.push(resolve));
  } else {
    active += 1;
  }

  try {
    return await work();
  } finally {
    const next = pending.shift();
    // Hand the slot to the oldest waiter before it resumes; newcomers cannot bypass it.
    if (next) next();
    else active -= 1;
  }
}

export const comparePassword = (password: string, hash: string): Promise<boolean> =>
  runPasswordWork(() => bcrypt.compare(password, hash));

export const hashPassword = (password: string): Promise<string> =>
  runPasswordWork(() => bcrypt.hash(password, 12));

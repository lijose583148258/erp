import { AuthController } from './auth.controller';
import { TeamController } from './team.controller';
import prisma from '../config/database';
import { comparePassword, hashPassword, PasswordWorkCapacityError } from '../services/auth-password-work.service';
import { createRefreshToken, deleteRefreshTokensForUser } from '../services/auth-token-store.service';
import { tryWriteAuthAuditLog, writeAuthAuditLog } from '../services/auth-audit.service';
import { canAssignPrivilegedRoles } from '../services/role-assignment-policy.service';

jest.mock('../config/database', () => ({ __esModule: true, default: {
    user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() }, auditLog: { create: jest.fn() },
} }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../services/auth-password-work.service', () => ({
    ...jest.requireActual('../services/auth-password-work.service'), comparePassword: jest.fn(), hashPassword: jest.fn(),
}));
jest.mock('../services/auth-token-store.service', () => ({
    createRefreshToken: jest.fn(), deleteRefreshTokensForUser: jest.fn(),
    blacklistAccessToken: jest.fn(), consumeRefreshToken: jest.fn(), deleteRefreshToken: jest.fn(),
}));
jest.mock('../services/auth-audit.service', () => ({ writeAuthAuditLog: jest.fn(), tryWriteAuthAuditLog: jest.fn() }));
jest.mock('../services/authorization-policy.service', () => ({
    roleExistsAndActive: jest.fn(async () => true), getPermissionsForRole: jest.fn(async () => []), getDataScopesForRole: jest.fn(async () => []),
}));
jest.mock('../services/role-assignment-policy.service', () => ({
    canAssignPrivilegedRoles: jest.fn(), isRoleAssignmentChange: jest.fn(() => true),
    resolveUserSegment: jest.fn(() => 'direct'), ROLE_ASSIGNMENT_PERMISSION: 'authorization.roles.manage',
}));
jest.mock('../utils/jwt', () => ({ generateToken: jest.fn(() => 'synthetic-access-token') }));
jest.mock('../security/mfa.service', () => ({ evaluateLoginMfa: jest.fn(() => ({ required: false, ok: true })) }));
jest.mock('../security/demo-credentials', () => ({ isReleaseDemoCredential: jest.fn(() => false) }));

const auth = new AuthController();
const team = new TeamController();
const user = { id: 7, username: 'synthetic', passwordHash: 'stored-hash', role: 'sales', segment: 'direct', isActive: true, mustChangePassword: false };
const request = () => ({ body: { username: 'synthetic', password: 'synthetic-password', oldPassword: 'old', newPassword: 'new' },
    user: { userId: 7, username: 'synthetic', role: 'admin' }, ip: '127.0.0.1', get: () => 'synthetic-agent' } as any);
const response = () => { const res: any = {}; res.status = jest.fn(() => res); res.json = jest.fn(() => res); return res; };

beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...user });
    (prisma.user.update as jest.Mock).mockResolvedValue({ updatedAt: new Date() });
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: 8, username: 'new-user' });
    (comparePassword as jest.Mock).mockResolvedValue(true);
    (hashPassword as jest.Mock).mockResolvedValue('new-hash');
    (canAssignPrivilegedRoles as jest.Mock).mockResolvedValue(true);
    (createRefreshToken as jest.Mock).mockResolvedValue({ refreshToken: 'synthetic-refresh-token' });
    (deleteRefreshTokensForUser as jest.Mock).mockResolvedValue(1);
});

const expectBusy = (res: any) => {
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorCode: 'PASSWORD_WORK_CAPACITY' }));
};
const expectNoWrites = () => {
    expect(prisma.user.create).not.toHaveBeenCalled(); expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled(); expect(createRefreshToken).not.toHaveBeenCalled();
    expect(deleteRefreshTokensForUser).not.toHaveBeenCalled(); expect(writeAuthAuditLog).not.toHaveBeenCalled();
    expect(tryWriteAuthAuditLog).not.toHaveBeenCalled();
};

test('login capacity exhaustion returns 503 before session, user or audit writes', async () => {
    (comparePassword as jest.Mock).mockRejectedValue(new PasswordWorkCapacityError());
    const res = response(); await auth.login(request(), res); expectBusy(res); expectNoWrites();
    expect(comparePassword).toHaveBeenCalledTimes(1); expect(hashPassword).not.toHaveBeenCalled();
});

test('invalid password stays 401 and is not retried or mistaken for capacity exhaustion', async () => {
    (comparePassword as jest.Mock).mockResolvedValue(false);
    const res = response(); await auth.login(request(), res);
    expect(res.status).toHaveBeenCalledWith(401); expect(comparePassword).toHaveBeenCalledTimes(1); expectNoWrites();
});

test('successful login keeps the original token and user update flow', async () => {
    const res = response(); await auth.login(request(), res);
    expect(comparePassword).toHaveBeenCalledWith('synthetic-password', 'stored-hash');
    expect(prisma.user.update).toHaveBeenCalledTimes(1); expect(createRefreshToken).toHaveBeenCalledWith(7);
    expect(tryWriteAuthAuditLog).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.objectContaining({ token: 'synthetic-access-token' }) }));
});

test.each(['register', 'createMember'] as const)('%s uses bounded hash work before creating a user', async method => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (hashPassword as jest.Mock).mockRejectedValue(new PasswordWorkCapacityError());
    const res = response();
    if (method === 'register') await auth.register(request(), res); else await team.createMember(request(), res);
    expectBusy(res); expect(hashPassword).toHaveBeenCalledTimes(1); expectNoWrites();
});

test('password change capacity exhaustion before comparison leaves password and sessions unchanged', async () => {
    (comparePassword as jest.Mock).mockRejectedValue(new PasswordWorkCapacityError());
    const res = response(); await auth.changePassword(request(), res); expectBusy(res); expectNoWrites();
    expect(hashPassword).not.toHaveBeenCalled();
});

test('password change capacity exhaustion before hashing does not write or revoke sessions', async () => {
    (hashPassword as jest.Mock).mockRejectedValue(new PasswordWorkCapacityError());
    const res = response(); await auth.changePassword(request(), res); expectBusy(res); expectNoWrites();
    expect(comparePassword).toHaveBeenCalledWith('old', 'stored-hash'); expect(hashPassword).toHaveBeenCalledWith('new');
});

test('successful password change keeps its single write, session revocation and audit', async () => {
    const res = response(); await auth.changePassword(request(), res);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ passwordHash: 'new-hash', mustChangePassword: false }) }));
    expect(deleteRefreshTokensForUser).toHaveBeenCalledWith(7); expect(writeAuthAuditLog).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('team authorization is still checked before password work or writes', async () => {
    (canAssignPrivilegedRoles as jest.Mock).mockResolvedValue(false);
    const res = response(); await team.createMember(request(), res);
    expect(res.status).toHaveBeenCalledWith(403); expect(hashPassword).not.toHaveBeenCalled(); expectNoWrites();
});

test('ordinary password computation failures remain server errors, not successful authentication', async () => {
    (comparePassword as jest.Mock).mockRejectedValue(new Error('synthetic computation failure'));
    const res = response(); await auth.login(request(), res);
    expect(res.status).toHaveBeenCalledWith(500); expectNoWrites(); expect(comparePassword).toHaveBeenCalledTimes(1);
});

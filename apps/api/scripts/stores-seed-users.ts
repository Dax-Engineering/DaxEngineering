// Dev only. Sign-in accounts for trying each role against the sample data.
// Removed again by pnpm db:reset:stores (found by their email domain).
import { hashPassword } from 'better-auth/crypto';
import type { PrismaService } from '@dax/platform-db';

export const SAMPLE_EMAIL_DOMAIN = 'sample.dax.test';
export const SAMPLE_ROLE_KEY = 'sample_department_head';
/** Local dev only; printed at the end of the seed. */
export const SAMPLE_PASSWORD = 'Dax-Sample-2026';

const HEAD_GRANTS: [permission: string, scope: 'DEPARTMENT' | 'ALL'][] = [
  ['inventory.aod.view', 'DEPARTMENT'],
  ['inventory.aod.approve', 'DEPARTMENT'],
  ['inventory.mrn.view', 'DEPARTMENT'],
  ['inventory.item.view', 'ALL'],
  ['inventory.stock.view', 'ALL'],
  ['inventory.low_stock.email', 'ALL'],
  ['core.department.head', 'ALL'],
];

interface SampleUser {
  username: string;
  name: string;
  roleKey: string;
  department: 'stores' | 'documents';
  what: string;
}

const USERS: SampleUser[] = [
  {
    username: 'manager',
    name: 'Stores Manager (sample)',
    roleKey: 'stores_manager',
    department: 'stores',
    what: 'everything in Stores, approves counts',
  },
  {
    username: 'keeper',
    name: 'Stores Keeper (sample)',
    roleKey: 'stores_keeper',
    department: 'stores',
    what: 'receives, issues, holds, returns and counts',
  },
  {
    username: 'viewer',
    name: 'Stock Viewer (sample)',
    roleKey: 'stock_viewer',
    department: 'stores',
    what: 'looks up parts, bins and stock only',
  },
  {
    username: 'depthead',
    name: 'Department Head (sample)',
    roleKey: SAMPLE_ROLE_KEY,
    department: 'documents',
    what: 'approves AODs for its department, gets low-stock alerts',
  },
];

/** Creates one sign-in account per role. Returns lines for the seed summary. */
export async function seedSampleUsers(
  prisma: PrismaService,
  documentsDepartmentId: string,
): Promise<string[]> {
  const stores = await prisma.department.findFirst({
    where: { key: 'stores' },
    select: { id: true },
  });
  const headRole = await prisma.role.create({
    data: {
      key: SAMPLE_ROLE_KEY,
      name: 'Department Head (sample)',
      description:
        'Sample role: approves AODs for its own departments and gets low-stock alerts.',
      permissions: {
        create: HEAD_GRANTS.map(([permissionKey, scope]) => ({
          permissionKey,
          scope,
          storeIds: [],
        })),
      },
    },
    select: { id: true },
  });
  const roles = await prisma.role.findMany({
    where: { key: { in: USERS.map((u) => u.roleKey) } },
    select: { id: true, key: true },
  });
  const roleId = new Map(roles.map((r) => [r.key, r.id]));
  roleId.set(SAMPLE_ROLE_KEY, headRole.id);

  const hash = await hashPassword(SAMPLE_PASSWORD);
  const lines: string[] = [];
  for (const u of USERS) {
    const departmentId =
      u.department === 'stores'
        ? (stores?.id ?? documentsDepartmentId)
        : documentsDepartmentId;
    const role = roleId.get(u.roleKey);
    if (!role) throw new Error(`Role ${u.roleKey} is missing`);
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: `${u.username}@${SAMPLE_EMAIL_DOMAIN}`,
        emailVerified: true,
        username: u.username,
        displayUsername: u.username,
        roles: { create: { roleId: role } },
        departments: { create: { departmentId } },
      },
      select: { id: true },
    });
    await prisma.account.create({
      data: {
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: hash,
      },
    });
    lines.push(`${u.username.padEnd(9)} ${u.name}: ${u.what}`);
  }
  return lines;
}

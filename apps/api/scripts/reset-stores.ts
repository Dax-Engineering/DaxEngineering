// Dev only. Wipes every stores record so the sample data can be loaded fresh.
// Run: pnpm db:reset:stores   Reseed in one go: pnpm db:reseed:stores
//
// Removed: all inventory and parties rows (items, bins, stock, documents,
// customers, suppliers, hand-made test records too), their audit, inbox,
// approval, attachment and numbering rows, queued events, and the sample and
// seed accounts. Kept: real user accounts, roles, departments, settings, the
// main store and the three stores settings rows.
//
// The stock ledger and audit log are append-only. Their triggers are switched
// off inside this one transaction, as the table owner, and back on before it
// commits.
import { PrismaService } from '@dax/platform-db';
import { assertLocalDatabase } from './seed-guard';
import { SEED_USER_IDS } from './stores-seed-data';
import { SAMPLE_EMAIL_DOMAIN, SAMPLE_ROLE_KEY } from './stores-seed-users';

const KEEP = new Set([
  'inventory.store',
  'inventory.low_stock_settings',
  'inventory.stock_age_settings',
  'inventory.item_serial_settings',
]);

async function main() {
  const url = process.env['MIGRATOR_DATABASE_URL'];
  if (!url)
    throw new Error(
      'MIGRATOR_DATABASE_URL is not set. Run through pnpm db:reset:stores.',
    );
  assertLocalDatabase(url);

  const prisma = new PrismaService({ url, applicationName: 'dax-reset' });
  try {
    const tables = await prisma.$queryRaw<{ name: string }[]>`
      SELECT schemaname || '.' || tablename AS name FROM pg_tables
      WHERE schemaname IN ('inventory', 'parties') ORDER BY 1`;
    const wipe = tables.map((t) => t.name).filter((t) => !KEEP.has(t));
    const sampleUsers = `
      SELECT id FROM auth."user"
      WHERE id = ANY($1::uuid[]) OR email LIKE '%@${SAMPLE_EMAIL_DOMAIN}'`;

    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE inventory.stock_ledger DISABLE TRIGGER USER',
        );
        await tx.$executeRawUnsafe(
          `TRUNCATE ${wipe
            .map((t) =>
              t
                .split('.')
                .map((part) => `"${part}"`)
                .join('.'),
            )
            .join(', ')} CASCADE`,
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE inventory.stock_ledger ENABLE TRIGGER USER',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE audit.audit_log DISABLE TRIGGER audit_log_append_only',
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM audit.audit_log
           WHERE module_key IN ('inventory', 'parties') OR actor_id IN (${sampleUsers})`,
          SEED_USER_IDS,
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE audit.audit_log ENABLE TRIGGER audit_log_append_only',
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM core.attachment WHERE module_key IN ('inventory', 'parties')`,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM core.approval_request WHERE module_key IN ('inventory', 'parties')`,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM core.inbox_message
           WHERE link LIKE '/inventory%' OR user_id IN (${sampleUsers})`,
          SEED_USER_IDS,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM core.number_counter WHERE series_id IN (
             SELECT id FROM core.number_series WHERE module_key IN ('inventory', 'parties'))`,
        );
        await tx.$executeRawUnsafe(
          'TRUNCATE core.outbox_event, core.processed_event, core.idempotency_key CASCADE',
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM core.job_run WHERE name LIKE 'inventory.%'`,
        );
        // Their access rows first: the version-bump triggers on these tables
        // write user_profile, which a cascade from auth.user would be deleting.
        for (const table of [
          'core.user_role',
          'core.user_department',
          'core.user_permission_override',
        ]) {
          await tx.$executeRawUnsafe(
            `DELETE FROM ${table} WHERE user_id IN (${sampleUsers})`,
            SEED_USER_IDS,
          );
        }
        await tx.$executeRawUnsafe(
          `DELETE FROM auth."user" WHERE id IN (${sampleUsers})`,
          SEED_USER_IDS,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM core.role WHERE key = '${SAMPLE_ROLE_KEY}'`,
        );
        // Mark the one-time jobs done so the worker can't run them mid-seed;
        // the seed runs both itself once its documents are in.
        await tx.$executeRawUnsafe(
          'UPDATE inventory.stock_age_settings SET rebuilt_at = now()',
        );
        await tx.$executeRawUnsafe(
          'UPDATE inventory.item_serial_settings SET existing_done_at = now()',
        );
        await tx.$executeRawUnsafe(
          'UPDATE inventory.low_stock_settings SET last_report_at = NULL',
        );
      },
      { timeout: 60_000 },
    );
    console.log(
      `Stores data removed: ${wipe.length} tables emptied, accounts kept.`,
    );
    console.log('Load the sample data with pnpm db:seed:stores.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

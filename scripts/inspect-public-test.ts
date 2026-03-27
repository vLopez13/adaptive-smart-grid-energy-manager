/**
 * Run against your Airbyte Postgres destination to print `public.test` columns and one sample row.
 * Usage: npx ts-node scripts/inspect-public-test.ts
 */
import { createPoolFromEnv, fetchLatestPublicTestRow } from '../src/context/postgresPublicTest';

async function main(): Promise<void> {
    const pool = createPoolFromEnv();
    if (!pool) {
        console.error('No Postgres config found. Set DATABASE_URL or PGHOST+PGDATABASE+PGUSER+PGPASSWORD.');
        process.exit(1);
    }
    try {
        const { columns, orderByColumn, row } = await fetchLatestPublicTestRow(pool);
        console.log('public.test columns:', columns.join(', ') || '(none)');
        console.log('ORDER BY (latest):', orderByColumn ?? '(none)');
        console.log('Latest row:', JSON.stringify(row, null, 2));
    } finally {
        await pool.end();
    }
}

void main();

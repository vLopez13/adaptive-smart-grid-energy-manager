import type { Pool, PoolConfig } from 'pg';
import { Pool as PgPool } from 'pg';
import type { ExternalContextRow } from '../types/energy';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function quoteIdent(name: string): string {
    if (!IDENT_RE.test(name)) {
        throw new Error(`Unsafe SQL identifier: ${name}`);
    }
    return `"${name.replace(/"/g, '""')}"`;
}

/** Prefer Airbyte / CDC timestamps so "latest" means recently synced. */
const ORDER_BY_CANDIDATES: string[] = [
    '_airbyte_extracted_at',
    '_airbyte_emitted_at',
    'airbyte_extracted_at',
    '_ab_cdc_updated_at',
    'updated_at',
    'timestamp',
    'created_at',
    'id',
];

export interface PostgresContextConfig {
    /** When false, Postgres is not used (caller should rely on simulator-only). */
    enabled: boolean;
    pool: Pool | null;
}

export function createPoolFromEnv(): Pool | null {
    const conn =
        process.env.DATABASE_URL ||
        process.env.POSTGRES_URL ||
        process.env.PG_CONNECTION_STRING;
    if (conn) {
        return new PgPool({ connectionString: conn, max: 4 });
    }
    const host = process.env.PGHOST || process.env.POSTGRES_HOST;
    const database = process.env.PGDATABASE || process.env.POSTGRES_DATABASE;
    if (host && database) {
        const cfg: PoolConfig = {
            host,
            port: parseInt(process.env.PGPORT || process.env.POSTGRES_PORT || '5432', 10),
            database,
            user: process.env.PGUSER || process.env.POSTGRES_USER,
            password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD,
            max: 4,
        };
        return new PgPool(cfg);
    }
    return null;
}

export function resolvePostgresContextConfig(): PostgresContextConfig {
    const pool = createPoolFromEnv();
    return { enabled: pool !== null, pool };
}

async function listPublicTestColumns(client: { query: Pool['query'] }): Promise<string[]> {
    const res = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'test'
     ORDER BY ordinal_position`
    );
    return res.rows.map((r) => r.column_name);
}

function pickOrderByColumn(columns: string[]): string | null {
    for (const cand of ORDER_BY_CANDIDATES) {
        for (const col of columns) {
            if (col.toLowerCase() === cand.toLowerCase()) {
                return col;
            }
        }
    }
    for (const col of columns) {
        const l = col.toLowerCase();
        if (l.includes('extracted_at') || l.includes('emitted_at') || l === 'updated_at' || l === 'created_at') {
            return col;
        }
    }
    for (const col of columns) {
        if (col.toLowerCase() === 'id') {
            return col;
        }
    }
    return columns.length > 0 ? columns[0]! : null;
}

export interface FetchLatestRowResult {
    row: ExternalContextRow;
    orderByColumn: string | null;
    columns: string[];
}

/**
 * Reads the latest synced row from `public.test` (Airbyte destination).
 * Does not call Airbyte — only Postgres.
 */
export async function fetchLatestPublicTestRow(pool: Pool): Promise<FetchLatestRowResult> {
    const client = await pool.connect();
    try {
        const columns = await listPublicTestColumns(client);
        if (columns.length === 0) {
            return { row: null, orderByColumn: null, columns: [] };
        }
        const orderCol = pickOrderByColumn(columns);
        if (!orderCol) {
            return { row: null, orderByColumn: null, columns };
        }
        const sql = `SELECT * FROM public.test ORDER BY ${quoteIdent(orderCol)} DESC NULLS LAST LIMIT 1`;
        const res = await client.query<Record<string, unknown>>(sql);
        const row = res.rows[0] ?? null;
        return { row, orderByColumn: orderCol, columns };
    } finally {
        client.release();
    }
}

/**
 * Safe entry: returns null row if Postgres is disabled or any error occurs (simulator fallback).
 */
export async function fetchLatestExternalContextSafe(pool: Pool | null): Promise<FetchLatestRowResult> {
    if (!pool) {
        return { row: null, orderByColumn: null, columns: [] };
    }
    try {
        return await fetchLatestPublicTestRow(pool);
    } catch {
        return { row: null, orderByColumn: null, columns: [] };
    }
}

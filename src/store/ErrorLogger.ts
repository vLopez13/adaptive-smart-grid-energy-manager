import 'dotenv/config';
import { Pool } from 'pg';

export interface ErrorLogEntry {
    id: string;
    message: string;
    stack?: string;
    clock: string;
    gridPrice: number;
    temperature: number;
}

export class ErrorLogger {
    private pool: Pool;

    constructor(pool?: Pool) {
        this.pool = pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
    }

    async ensureTable(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS error_log (
                id TEXT PRIMARY KEY,
                message TEXT,
                stack TEXT,
                clock TEXT,
                grid_price NUMERIC,
                temperature NUMERIC,
                logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
    }

    async log(entry: ErrorLogEntry): Promise<void> {
        try {
            await this.ensureTable();
            await this.pool.query(
                `INSERT INTO error_log (id, message, stack, clock, grid_price, temperature)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    entry.id,
                    entry.message,
                    entry.stack ?? null,
                    entry.clock,
                    entry.gridPrice,
                    entry.temperature,
                ]
            );
        } catch (err) {
            console.warn('[ErrorLogger] Failed to log error:', err instanceof Error ? err.message : String(err));
        }
    }
}

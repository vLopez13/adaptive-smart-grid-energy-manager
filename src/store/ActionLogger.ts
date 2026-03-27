import 'dotenv/config';
import { Pool } from 'pg';

export interface ActionLogEntry {
    id: string;
    action: string;
    clock: string;
    gridPrice: number;
    temperature: number;
    estimatedRevenue?: number;
    activeGuidelineIds: string[];
}

export class ActionLogger {
    private pool: Pool;

    constructor(pool?: Pool) {
        this.pool = pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
    }

    async ensureTable(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS action_log (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                clock TEXT,
                grid_price NUMERIC,
                temperature NUMERIC,
                estimated_revenue NUMERIC,
                active_guideline_ids TEXT[],
                logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
    }

    async log(entry: ActionLogEntry): Promise<void> {
        try {
            await this.ensureTable();
            await this.pool.query(
                `INSERT INTO action_log (id, action, clock, grid_price, temperature, estimated_revenue, active_guideline_ids)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    entry.id,
                    entry.action,
                    entry.clock,
                    entry.gridPrice,
                    entry.temperature,
                    entry.estimatedRevenue ?? null,
                    entry.activeGuidelineIds,
                ]
            );
        } catch (err) {
            console.warn('[ActionLogger] Failed to log action:', err instanceof Error ? err.message : String(err));
        }
    }
}

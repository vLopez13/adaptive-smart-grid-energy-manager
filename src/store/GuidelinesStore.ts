import { Pool } from 'pg';

export interface Guideline {
    id: string;
    text: string;
    createdAt: string;
    timesApplied: number;
}

interface GuidelineRow {
    id: string;
    text: string;
    created_at: Date;
    times_applied: number;
}

const CREATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS preference_guidelines (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        times_applied INTEGER NOT NULL DEFAULT 0
    )
`;

export class GuidelinesStore {
    private pool: Pool;
    private initialized = false;

    constructor(pool?: Pool) {
        this.pool = pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
    }

    private async ensureTable(): Promise<void> {
        if (this.initialized) return;
        await this.pool.query(CREATE_TABLE_SQL);
        this.initialized = true;
    }

    async load(): Promise<Guideline[]> {
        await this.ensureTable();
        const result = await this.pool.query<GuidelineRow>(
            'SELECT id, text, created_at, times_applied FROM preference_guidelines ORDER BY created_at ASC'
        );
        return result.rows.map(this.toGuideline);
    }

    async add(guideline: Guideline): Promise<void> {
        await this.ensureTable();
        await this.pool.query(
            'INSERT INTO preference_guidelines (id, text, created_at, times_applied) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
            [guideline.id, guideline.text, guideline.createdAt, guideline.timesApplied]
        );
    }

    async remove(id: string): Promise<void> {
        await this.ensureTable();
        await this.pool.query('DELETE FROM preference_guidelines WHERE id = $1', [id]);
    }

    async incrementApplied(id: string): Promise<void> {
        await this.ensureTable();
        await this.pool.query(
            'UPDATE preference_guidelines SET times_applied = times_applied + 1 WHERE id = $1',
            [id]
        );
    }

    async clear(): Promise<void> {
        await this.ensureTable();
        await this.pool.query('DELETE FROM preference_guidelines');
    }

    private toGuideline(row: GuidelineRow): Guideline {
        return {
            id: row.id,
            text: row.text,
            createdAt: row.created_at.toISOString(),
            timesApplied: row.times_applied,
        };
    }
}

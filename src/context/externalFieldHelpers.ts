import type { ExternalContextRow } from '../types/energy';

function normalizeKey(k: string): string {
    return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Resolves a value from an Airbyte row with flexible key matching. */
export function getRowValue(row: ExternalContextRow, ...candidates: string[]): unknown {
    if (!row) {
        return undefined;
    }
    const keys = Object.keys(row);
    const normalized = new Map<string, string>();
    for (const k of keys) {
        normalized.set(normalizeKey(k), k);
    }
    for (const c of candidates) {
        const nk = normalizeKey(c);
        const actual = normalized.get(nk);
        if (actual !== undefined) {
            return row[actual];
        }
    }
    return undefined;
}

export function getNumericField(row: ExternalContextRow, ...candidates: string[]): number | undefined {
    const v = getRowValue(row, ...candidates);
    if (typeof v === 'number' && !Number.isNaN(v)) {
        return v;
    }
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (!Number.isNaN(n)) {
            return n;
        }
    }
    return undefined;
}

export function getBooleanField(row: ExternalContextRow, ...candidates: string[]): boolean | undefined {
    const v = getRowValue(row, ...candidates);
    if (typeof v === 'boolean') {
        return v;
    }
    if (typeof v === 'string') {
        const s = v.toLowerCase();
        if (s === 'true' || s === 't' || s === '1') {
            return true;
        }
        if (s === 'false' || s === 'f' || s === '0') {
            return false;
        }
    }
    if (typeof v === 'number') {
        return v !== 0;
    }
    return undefined;
}

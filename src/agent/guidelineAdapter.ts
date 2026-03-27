import type { Action, DecisionContext } from '../types/energy';
import type { PreferenceGuideline } from './PreferenceGuideline';
import type { Guideline } from '../store/GuidelinesStore';

/**
 * Canonical guideline text format (produced by Preference Learning engine, Req 5):
 *   "Do not {ACTION} when {FIELD} {OP} {VALUE}"
 *
 * Supported fields:
 *   Temperature   — maps to context.simulator.weatherTemperature
 *   Grid_Price    — maps to context.simulator.gridPrice
 *   Clock_Hour    — maps to the hour parsed from context.simulator.clock (HH:MM)
 *
 * Supported operators: >, <, >=, <=
 *
 * Examples:
 *   "Do not SHUT_OFF_AC when Temperature > 90"
 *   "Do not SELL_TO_GRID when Grid_Price < 0.10"
 *   "Do not CHARGE_EV_NOW when Clock_Hour >= 17"
 */

const ACTIONS = new Set<Action>([
    'SELL_TO_GRID', 'BUY_FROM_GRID', 'STORE_IN_BATTERY', 'DISCHARGE_BATTERY',
    'SHUT_OFF_AC', 'RESTORE_AC', 'CHARGE_EV_NOW', 'PAUSE_EV_CHARGING',
]);

const PATTERN = /^Do not ([A-Z_]+) when (Temperature|Grid_Price|Clock_Hour)\s*(>=|<=|>|<)\s*([\d.]+)$/i;

type Op = '>' | '<' | '>=' | '<=';

function compare(lhs: number, op: Op, rhs: number): boolean {
    switch (op) {
        case '>':  return lhs > rhs;
        case '<':  return lhs < rhs;
        case '>=': return lhs >= rhs;
        case '<=': return lhs <= rhs;
    }
}

function extractField(field: string, context: DecisionContext): number {
    const f = field.toLowerCase();
    if (f === 'temperature') return context.simulator.weatherTemperature;
    if (f === 'grid_price')  return context.simulator.gridPrice;
    if (f === 'clock_hour') {
        const [hh] = context.simulator.clock.split(':').map(Number);
        return hh ?? 0;
    }
    return NaN;
}

/**
 * Convert a persisted Guideline (text-based) into a runtime PreferenceGuideline.
 * Returns null if the text cannot be parsed (guideline is silently ignored).
 */
export function toPreferenceGuideline(g: Guideline): PreferenceGuideline | null {
    const match = PATTERN.exec(g.text.trim());
    if (!match) return null;

    const [, actionRaw, field, opRaw, valueRaw] = match;
    const action = actionRaw!.toUpperCase() as Action;
    if (!ACTIONS.has(action)) return null;

    const op = opRaw as Op;
    const threshold = parseFloat(valueRaw!);
    if (isNaN(threshold)) return null;

    return {
        id: g.id,
        excludedAction: action,
        applies: (context: DecisionContext) =>
            compare(extractField(field!, context), op, threshold),
    };
}

/**
 * Convert all persisted Guidelines to PreferenceGuidelines, silently dropping
 * any that cannot be parsed.
 */
export function toPreferenceGuidelines(guidelines: Guideline[]): PreferenceGuideline[] {
    return guidelines.flatMap((g) => {
        const pg = toPreferenceGuideline(g);
        return pg ? [pg] : [];
    });
}

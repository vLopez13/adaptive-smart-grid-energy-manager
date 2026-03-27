import { toPreferenceGuideline, toPreferenceGuidelines } from './guidelineAdapter';
import type { Guideline } from '../store/GuidelinesStore';
import type { DecisionContext } from '../types/energy';

function makeGuideline(text: string): Guideline {
    return { id: 'g1', text, createdAt: '2026-01-01T00:00:00Z', timesApplied: 0 };
}

function makeContext(overrides: Partial<{ temp: number; price: number; clock: string }>): DecisionContext {
    return {
        simulator: {
            weatherTemperature: overrides.temp ?? 72,
            gridPrice: overrides.price ?? 0.15,
            clock: overrides.clock ?? '10:00',
        },
        external: null,
    };
}

describe('toPreferenceGuideline', () => {
    it('parses a Temperature > guideline', () => {
        const pg = toPreferenceGuideline(makeGuideline('Do not SHUT_OFF_AC when Temperature > 90'));
        expect(pg).not.toBeNull();
        expect(pg!.excludedAction).toBe('SHUT_OFF_AC');
        expect(pg!.applies(makeContext({ temp: 91 }))).toBe(true);
        expect(pg!.applies(makeContext({ temp: 89 }))).toBe(false);
        expect(pg!.applies(makeContext({ temp: 90 }))).toBe(false);
    });

    it('parses a Grid_Price < guideline', () => {
        const pg = toPreferenceGuideline(makeGuideline('Do not SELL_TO_GRID when Grid_Price < 0.10'));
        expect(pg).not.toBeNull();
        expect(pg!.excludedAction).toBe('SELL_TO_GRID');
        expect(pg!.applies(makeContext({ price: 0.09 }))).toBe(true);
        expect(pg!.applies(makeContext({ price: 0.11 }))).toBe(false);
    });

    it('parses a Clock_Hour >= guideline', () => {
        const pg = toPreferenceGuideline(makeGuideline('Do not CHARGE_EV_NOW when Clock_Hour >= 17'));
        expect(pg).not.toBeNull();
        expect(pg!.excludedAction).toBe('CHARGE_EV_NOW');
        expect(pg!.applies(makeContext({ clock: '17:00' }))).toBe(true);
        expect(pg!.applies(makeContext({ clock: '20:30' }))).toBe(true);
        expect(pg!.applies(makeContext({ clock: '16:59' }))).toBe(false);
    });

    it('parses <= operator', () => {
        const pg = toPreferenceGuideline(makeGuideline('Do not BUY_FROM_GRID when Temperature <= 40'));
        expect(pg).not.toBeNull();
        expect(pg!.applies(makeContext({ temp: 40 }))).toBe(true);
        expect(pg!.applies(makeContext({ temp: 41 }))).toBe(false);
    });

    it('returns null for unrecognised text', () => {
        expect(toPreferenceGuideline(makeGuideline('something random'))).toBeNull();
    });

    it('returns null for unknown action', () => {
        expect(toPreferenceGuideline(makeGuideline('Do not EXPLODE when Temperature > 50'))).toBeNull();
    });
});

describe('toPreferenceGuidelines', () => {
    it('converts a list, silently dropping unparseable entries', () => {
        const guidelines: Guideline[] = [
            makeGuideline('Do not SHUT_OFF_AC when Temperature > 90'),
            { ...makeGuideline('bad text'), id: 'g2' },
            { ...makeGuideline('Do not SELL_TO_GRID when Grid_Price < 0.10'), id: 'g3' },
        ];
        const result = toPreferenceGuidelines(guidelines);
        expect(result).toHaveLength(2);
        expect(result[0].excludedAction).toBe('SHUT_OFF_AC');
        expect(result[1].excludedAction).toBe('SELL_TO_GRID');
    });

    it('returns empty array when all entries are unparseable', () => {
        expect(toPreferenceGuidelines([makeGuideline('garbage')])).toEqual([]);
    });
});

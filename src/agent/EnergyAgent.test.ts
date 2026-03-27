import { EnergyAgent } from './EnergyAgent';
import { proposeDecision } from './decisionPolicy';
import { toPreferenceGuideline } from './guidelineAdapter';

describe('EnergyAgent', () => {
    /** Calm conditions so first proposal is Grid-led STORE_IN_BATTERY. */
    const baseCtx = {
        simulator: {
            clock: '10:30',
            gridPrice: 0.15,
            weatherTemperature: 72,
        },
        external: null as Record<string, unknown> | null,
    };

    test('returns exactly one action with primary reason in allowed set', () => {
        const agent = new EnergyAgent([]);
        const d = agent.decide(baseCtx);
        expect(d.action).toBeTruthy();
        expect(['Grid_Price', 'Weather_Temperature', 'Clock']).toContain(d.primaryReason);
    });

    test('applies guideline by excluding a blocked action', () => {
        const agent = new EnergyAgent([
            {
                id: 'g1',
                excludedAction: 'STORE_IN_BATTERY',
                applies: () => true,
            },
        ]);
        const plain = proposeDecision(baseCtx);
        const withG = agent.decide(baseCtx);
        if (plain.action === 'STORE_IN_BATTERY') {
            expect(withG.action).not.toBe('STORE_IN_BATTERY');
        }
    });

    test('uses external row for EV connectivity', () => {
        const agent = new EnergyAgent([]);
        const ctx = {
            simulator: { clock: '02:00', gridPrice: 0.15, weatherTemperature: 70 },
            external: { ev_connected: false } as Record<string, unknown>,
        };
        const d = agent.decide(ctx);
        expect(d.action).toBe('STORE_IN_BATTERY');
        expect(d.reasonDetail.toLowerCase()).toContain('ev');
    });

    // ====== applyPenalty tests ======

    test('applyPenalty with high grid price returns guideline text matching Grid_Price', () => {
        const agent = new EnergyAgent([]);
        const guideline = agent.applyPenalty('SELL_TO_GRID', {
            clock: '14:00',
            gridPrice: 0.45,
            weatherTemperature: 72,
        });
        expect(guideline.text).toMatch(/^Do not SELL_TO_GRID when Grid_Price >= 0\.45$/);
        expect(guideline.id).toBeTruthy();
        expect(guideline.createdAt).toBeTruthy();
        expect(guideline.timesApplied).toBe(0);
    });

    test('applyPenalty with extreme high temperature returns guideline text matching Temperature', () => {
        const agent = new EnergyAgent([]);
        const guideline = agent.applyPenalty('SHUT_OFF_AC', {
            clock: '14:00',
            gridPrice: 0.20,
            weatherTemperature: 98,
        });
        expect(guideline.text).toMatch(/^Do not SHUT_OFF_AC when Temperature >= 98$/);
    });

    test('applyPenalty with peak hour returns guideline text matching Clock_Hour >= 17', () => {
        const agent = new EnergyAgent([]);
        // Low urgency on price and temperature so Clock dominates
        const guideline = agent.applyPenalty('PAUSE_EV_CHARGING', {
            clock: '18:00',
            gridPrice: 0.20,
            weatherTemperature: 72,
        });
        expect(guideline.text).toMatch(/^Do not PAUSE_EV_CHARGING when Clock_Hour >= 17$/);
    });

    test('applyPenalty generated text is parseable by toPreferenceGuideline', () => {
        const agent = new EnergyAgent([]);
        const guideline = agent.applyPenalty('BUY_FROM_GRID', {
            clock: '10:00',
            gridPrice: 0.07,
            weatherTemperature: 72,
        });
        const pg = toPreferenceGuideline(guideline);
        expect(pg).not.toBeNull();
        expect(pg!.excludedAction).toBe('BUY_FROM_GRID');
    });

    // ====== decide() with blocking guidelines ======

    test('decide() with a guideline blocking the top proposal falls through to next proposal', () => {
        const baseCtxHighPrice = {
            simulator: {
                clock: '14:00',
                gridPrice: 0.45,
                weatherTemperature: 72,
            },
            external: null as Record<string, unknown> | null,
        };
        // Without guideline, should propose SELL_TO_GRID (high price)
        const agentNoG = new EnergyAgent([]);
        const first = agentNoG.decide(baseCtxHighPrice);
        expect(first.action).toBe('SELL_TO_GRID');

        // With guideline blocking SELL_TO_GRID, should fall through
        const agent = new EnergyAgent([
            {
                id: 'block-sell',
                excludedAction: 'SELL_TO_GRID',
                applies: () => true,
            },
        ]);
        const decision = agent.decide(baseCtxHighPrice);
        expect(decision.action).not.toBe('SELL_TO_GRID');
    });

    test('getLastAppliedGuidelineIds() returns IDs of guidelines that blocked proposals', () => {
        const baseCtxHighPrice = {
            simulator: {
                clock: '14:00',
                gridPrice: 0.45,
                weatherTemperature: 72,
            },
            external: null as Record<string, unknown> | null,
        };
        const blockingId = 'block-sell-id-123';
        const agent = new EnergyAgent([
            {
                id: blockingId,
                excludedAction: 'SELL_TO_GRID',
                applies: () => true,
            },
        ]);
        agent.decide(baseCtxHighPrice);
        const ids = agent.getLastAppliedGuidelineIds();
        expect(ids).toContain(blockingId);
    });

    test('decide() with no blocking guidelines returns empty getLastAppliedGuidelineIds()', () => {
        const agent = new EnergyAgent([]);
        agent.decide(baseCtx);
        expect(agent.getLastAppliedGuidelineIds()).toEqual([]);
    });
});

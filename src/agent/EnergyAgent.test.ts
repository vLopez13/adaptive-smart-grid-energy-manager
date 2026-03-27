import { EnergyAgent } from './EnergyAgent';
import { proposeDecision } from './decisionPolicy';

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
});

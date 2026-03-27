import { orderDimensionsByUrgency, proposeForDimension, listProposalsInOrder } from './decisionPolicy';
import type { DecisionContext } from '../types/energy';

function ctx(
    clock: string,
    gridPrice: number,
    weatherTemperature: number,
    external: DecisionContext['external'] = null
): DecisionContext {
    return { simulator: { clock, gridPrice, weatherTemperature }, external };
}

describe('orderDimensionsByUrgency', () => {
    it('puts Weather_Temperature first when temperature is extreme (>=95°F)', () => {
        const order = orderDimensionsByUrgency(ctx('10:00', 0.15, 96));
        expect(order[0]).toBe('Weather_Temperature');
    });

    it('puts Grid_Price first when price is very high (>=0.42) and temp is comfortable', () => {
        const order = orderDimensionsByUrgency(ctx('10:00', 0.45, 72));
        expect(order[0]).toBe('Grid_Price');
    });

    it('puts Clock first when during peak hours and other dims are calm', () => {
        const order = orderDimensionsByUrgency(ctx('18:00', 0.15, 72));
        expect(order[0]).toBe('Clock');
    });

    it('uses Weather_Temperature tie-break over Grid_Price when both urgency equal', () => {
        // Both at 0 urgency — tie-break by comfort > economics
        const order = orderDimensionsByUrgency(ctx('10:00', 0.15, 72));
        expect(order[0]).toBe('Weather_Temperature');
    });

    it('returns all three dimensions', () => {
        const order = orderDimensionsByUrgency(ctx('14:00', 0.20, 75));
        expect(order).toHaveLength(3);
        expect(order).toContain('Weather_Temperature');
        expect(order).toContain('Grid_Price');
        expect(order).toContain('Clock');
    });
});

describe('proposeForDimension — Weather_Temperature', () => {
    it('proposes SHUT_OFF_AC at >=93°F', () => {
        const d = proposeForDimension('Weather_Temperature', ctx('10:00', 0.15, 93), {});
        expect(d.action).toBe('SHUT_OFF_AC');
        expect(d.primaryReason).toBe('Weather_Temperature');
    });

    it('proposes RESTORE_AC at <=36°F', () => {
        const d = proposeForDimension('Weather_Temperature', ctx('10:00', 0.15, 36), {});
        expect(d.action).toBe('RESTORE_AC');
    });

    it('proposes PAUSE_EV_CHARGING between 86°F and 92°F', () => {
        const d = proposeForDimension('Weather_Temperature', ctx('10:00', 0.15, 88), {});
        expect(d.action).toBe('PAUSE_EV_CHARGING');
    });
});

describe('proposeForDimension — Grid_Price', () => {
    it('proposes SELL_TO_GRID at high price (>=0.34)', () => {
        const d = proposeForDimension('Grid_Price', ctx('10:00', 0.40, 72), {});
        expect(d.action).toBe('SELL_TO_GRID');
    });

    it('proposes STORE_IN_BATTERY at high price when battery is low', () => {
        const d = proposeForDimension('Grid_Price', ctx('10:00', 0.40, 72), { batteryLevel: 0.10 });
        expect(d.action).toBe('STORE_IN_BATTERY');
    });

    it('proposes BUY_FROM_GRID at low price (<=0.09)', () => {
        const d = proposeForDimension('Grid_Price', ctx('10:00', 0.07, 72), {});
        expect(d.action).toBe('BUY_FROM_GRID');
    });

    it('proposes DISCHARGE_BATTERY at elevated price (>=0.24)', () => {
        const d = proposeForDimension('Grid_Price', ctx('10:00', 0.25, 72), {});
        expect(d.action).toBe('DISCHARGE_BATTERY');
    });

    it('proposes STORE_IN_BATTERY at moderate price', () => {
        const d = proposeForDimension('Grid_Price', ctx('10:00', 0.15, 72), {});
        expect(d.action).toBe('STORE_IN_BATTERY');
    });
});

describe('proposeForDimension — Clock', () => {
    it('proposes PAUSE_EV_CHARGING during peak (17:00–21:00)', () => {
        const d = proposeForDimension('Clock', ctx('18:00', 0.15, 72), {});
        expect(d.action).toBe('PAUSE_EV_CHARGING');
    });

    it('proposes CHARGE_EV_NOW during off-peak when EV is connected', () => {
        const d = proposeForDimension('Clock', ctx('02:00', 0.15, 72), { evConnected: true });
        expect(d.action).toBe('CHARGE_EV_NOW');
    });

    it('proposes STORE_IN_BATTERY during off-peak when EV is not connected', () => {
        const d = proposeForDimension('Clock', ctx('02:00', 0.15, 72), { evConnected: false });
        expect(d.action).toBe('STORE_IN_BATTERY');
    });

    it('proposes STORE_IN_BATTERY during midday (11:00–15:00)', () => {
        const d = proposeForDimension('Clock', ctx('13:00', 0.15, 72), {});
        expect(d.action).toBe('STORE_IN_BATTERY');
    });
});

describe('listProposalsInOrder', () => {
    it('returns 3 proposals, one per dimension', () => {
        const proposals = listProposalsInOrder(ctx('10:00', 0.15, 72));
        expect(proposals).toHaveLength(3);
        const reasons = new Set(proposals.map((p) => p.primaryReason));
        expect(reasons.size).toBe(3);
    });

    it('first proposal is from highest-urgency dimension', () => {
        // Extreme temperature should dominate
        const proposals = listProposalsInOrder(ctx('10:00', 0.15, 96));
        expect(proposals[0].primaryReason).toBe('Weather_Temperature');
        expect(proposals[0].action).toBe('SHUT_OFF_AC');
    });

    it('falls back to Grid_Price first when all urgencies are zero', () => {
        // Calm conditions: 72°F, $0.15, 10:00 — all urgency = 0
        const proposals = listProposalsInOrder(ctx('10:00', 0.15, 72));
        expect(proposals[0].primaryReason).toBe('Grid_Price');
    });
});

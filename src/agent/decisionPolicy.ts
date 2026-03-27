import type { Action, AgentDecision, DecisionContext, PrimaryReason } from '../types/energy';
import { getBooleanField, getNumericField } from '../context/externalFieldHelpers';

export interface ParsedExternalHints {
    batteryLevel?: number;
    evConnected?: boolean;
}

export function parseExternalHints(row: DecisionContext['external']): ParsedExternalHints {
    return {
        batteryLevel: getNumericField(row, 'battery_level', 'batteryLevel', 'battery'),
        evConnected: getBooleanField(row, 'ev_connected', 'evConnected', 'evconnected'),
    };
}

function parseHour(clock: string): number {
    const [h] = clock.split(':').map((x) => parseInt(x, 10));
    return Number.isFinite(h) ? h! : 0;
}

export type DecisionDimension = PrimaryReason;

function urgencyWeather(temp: number): number {
    if (temp >= 95) {
        return 100;
    }
    if (temp <= 32) {
        return 95;
    }
    if (temp >= 88) {
        return 70;
    }
    if (temp <= 40) {
        return 65;
    }
    if (temp >= 82) {
        return 40;
    }
    if (temp <= 48) {
        return 35;
    }
    return 0;
}

function urgencyPrice(price: number): number {
    if (price >= 0.42) {
        return 100;
    }
    if (price <= 0.07) {
        return 95;
    }
    if (price >= 0.32) {
        return 75;
    }
    if (price <= 0.1) {
        return 70;
    }
    if (price >= 0.26) {
        return 45;
    }
    return 0;
}

function urgencyClock(hour: number): number {
    if (hour >= 17 && hour <= 21) {
        return 85;
    }
    if (hour >= 23 || hour <= 5) {
        return 55;
    }
    if (hour >= 11 && hour <= 15) {
        return 40;
    }
    return 0;
}

export function proposeForDimension(dim: DecisionDimension, ctx: DecisionContext, hints: ParsedExternalHints): AgentDecision {
    const { clock, gridPrice: p, weatherTemperature: t } = ctx.simulator;
    const hour = parseHour(clock);

    if (dim === 'Weather_Temperature') {
        if (t >= 93) {
            return {
                action: 'SHUT_OFF_AC',
                primaryReason: 'Weather_Temperature',
                reasonDetail: `Outdoor temperature ${t.toFixed(1)}°F is very high; reducing HVAC load.`,
            };
        }
        if (t <= 36) {
            return {
                action: 'RESTORE_AC',
                primaryReason: 'Weather_Temperature',
                reasonDetail: `Outdoor temperature ${t.toFixed(1)}°F is low; restoring comfort settings.`,
            };
        }
        if (t >= 86) {
            return {
                action: 'PAUSE_EV_CHARGING',
                primaryReason: 'Weather_Temperature',
                reasonDetail: `Warm conditions (${t.toFixed(1)}°F); deferring flexible loads.`,
            };
        }
        return {
            action: 'RESTORE_AC',
            primaryReason: 'Weather_Temperature',
            reasonDetail: `Temperature ${t.toFixed(1)}°F is within a comfortable band; maintaining comfort.`,
        };
    }

    if (dim === 'Grid_Price') {
        if (p >= 0.34) {
            const lowBat = hints.batteryLevel !== undefined && hints.batteryLevel < 0.18;
            if (lowBat) {
                return {
                    action: 'STORE_IN_BATTERY',
                    primaryReason: 'Grid_Price',
                    reasonDetail: `High grid price ($${p.toFixed(3)}/kWh) but battery is low; prioritizing storage.`,
                };
            }
            return {
                action: 'SELL_TO_GRID',
                primaryReason: 'Grid_Price',
                reasonDetail: `High grid price ($${p.toFixed(3)}/kWh); exporting surplus while rates are favorable.`,
            };
        }
        if (p <= 0.09) {
            return {
                action: 'BUY_FROM_GRID',
                primaryReason: 'Grid_Price',
                reasonDetail: `Low grid price ($${p.toFixed(3)}/kWh); importing while power is cheap.`,
            };
        }
        if (p >= 0.24) {
            return {
                action: 'DISCHARGE_BATTERY',
                primaryReason: 'Grid_Price',
                reasonDetail: `Elevated price ($${p.toFixed(3)}/kWh); discharging stored energy to reduce grid use.`,
            };
        }
        return {
            action: 'STORE_IN_BATTERY',
            primaryReason: 'Grid_Price',
            reasonDetail: `Moderate price ($${p.toFixed(3)}/kWh); storing energy for later.`,
        };
    }

    // Clock
    if (hour >= 17 && hour <= 21) {
        return {
            action: 'PAUSE_EV_CHARGING',
            primaryReason: 'Clock',
            reasonDetail: `Peak window (${clock}); deferring EV charging to protect demand charges.`,
        };
    }
    if (hour >= 23 || hour <= 6) {
        const ev = hints.evConnected;
        if (ev === false) {
            return {
                action: 'STORE_IN_BATTERY',
                primaryReason: 'Clock',
                reasonDetail: `Off-peak window (${clock}), but EV not connected; storing energy instead.`,
            };
        }
        return {
            action: 'CHARGE_EV_NOW',
            primaryReason: 'Clock',
            reasonDetail: `Off-peak window (${clock}); shifting EV charging to cheaper hours.`,
        };
    }
    if (hour >= 11 && hour <= 15) {
        return {
            action: 'STORE_IN_BATTERY',
            primaryReason: 'Clock',
            reasonDetail: `Midday window (${clock}); favoring battery storage.`,
        };
    }
    return {
        action: 'CHARGE_EV_NOW',
        primaryReason: 'Clock',
        reasonDetail: `Time-of-day (${clock}); opportunistic EV charging when conditions allow.`,
    };
}

export function orderDimensionsByUrgency(ctx: DecisionContext): DecisionDimension[] {
    const { clock, gridPrice, weatherTemperature } = ctx.simulator;
    const hour = parseHour(clock);
    const uw = urgencyWeather(weatherTemperature);
    const up = urgencyPrice(gridPrice);
    const uc = urgencyClock(hour);

    const scored: Array<{ dim: DecisionDimension; u: number }> = [
        { dim: 'Weather_Temperature', u: uw },
        { dim: 'Grid_Price', u: up },
        { dim: 'Clock', u: uc },
    ];
    scored.sort((a, b) => {
        if (b.u !== a.u) {
            return b.u - a.u;
        }
        // Tie-break: comfort, economics, scheduling
        const order: DecisionDimension[] = ['Weather_Temperature', 'Grid_Price', 'Clock'];
        return order.indexOf(a.dim) - order.indexOf(b.dim);
    });
    return scored.map((s) => s.dim);
}

function isAllUrgencyZero(ctx: DecisionContext): boolean {
    const { gridPrice, weatherTemperature, clock } = ctx.simulator;
    const hour = parseHour(clock);
    return (
        urgencyWeather(weatherTemperature) === 0 &&
        urgencyPrice(gridPrice) === 0 &&
        urgencyClock(hour) === 0
    );
}

/**
 * Ordered candidate decisions (urgency order, then full dimension sweep). The Agent
 * picks the first proposal whose action is allowed by guidelines.
 */
export function listProposalsInOrder(ctx: DecisionContext): AgentDecision[] {
    const hints = parseExternalHints(ctx.external);
    const ranked = orderDimensionsByUrgency(ctx);
    const primaryOrder: DecisionDimension[] = isAllUrgencyZero(ctx)
        ? ['Grid_Price', 'Weather_Temperature', 'Clock']
        : ranked;

    const seen = new Set<DecisionDimension>();
    const out: AgentDecision[] = [];
    for (const dim of primaryOrder) {
        if (seen.has(dim)) {
            continue;
        }
        seen.add(dim);
        out.push(proposeForDimension(dim, ctx, hints));
    }
    const rest: DecisionDimension[] = ['Weather_Temperature', 'Grid_Price', 'Clock'];
    for (const dim of rest) {
        if (seen.has(dim)) {
            continue;
        }
        seen.add(dim);
        out.push(proposeForDimension(dim, ctx, hints));
    }
    return out;
}

/** First-choice proposal (no guideline filtering). */
export function proposeDecision(ctx: DecisionContext): AgentDecision {
    return listProposalsInOrder(ctx)[0]!;
}

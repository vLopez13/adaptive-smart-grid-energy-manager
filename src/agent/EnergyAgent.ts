import { v4 as uuidv4 } from 'uuid';
import type { Action, AgentDecision, DecisionContext } from '../types/energy';
import { listProposalsInOrder, orderDimensionsByUrgency } from './decisionPolicy';
import { findBlockingGuidelineIds, type PreferenceGuideline } from './PreferenceGuideline';
import type { Guideline } from '../store/GuidelinesStore';

export class EnergyAgent {
    private lastAppliedGuidelineIds: string[] = [];

    constructor(private guidelines: PreferenceGuideline[] = []) {}

    getGuidelines(): readonly PreferenceGuideline[] {
        return this.guidelines;
    }

    setGuidelines(next: PreferenceGuideline[]): void {
        this.guidelines = next;
    }

    getLastAppliedGuidelineIds(): string[] {
        return this.lastAppliedGuidelineIds;
    }

    /**
     * One decision cycle: propose from streams + external context, then apply guidelines.
     */
    decide(context: DecisionContext): AgentDecision {
        this.lastAppliedGuidelineIds = [];
        try {
            for (const proposal of listProposalsInOrder(context)) {
                const blockingIds = findBlockingGuidelineIds(proposal.action, context, this.guidelines);
                if (blockingIds.length === 0) {
                    return proposal;
                }
                for (const id of blockingIds) {
                    if (!this.lastAppliedGuidelineIds.includes(id)) {
                        this.lastAppliedGuidelineIds.push(id);
                    }
                }
            }
            return {
                action: 'STORE_IN_BATTERY',
                primaryReason: 'Grid_Price',
                reasonDetail:
                    'All ranked proposals were blocked by preference guidelines; using storage default.',
            };
        } catch {
            return {
                action: 'STORE_IN_BATTERY',
                primaryReason: 'Grid_Price',
                reasonDetail: 'Decision error; defaulting to storage.',
            };
        }
    }

    /**
     * Generate a penalty guideline from a user override. Produces text in the exact format
     * parsed by guidelineAdapter.ts: "Do not {ACTION} when {FIELD} {OP} {VALUE}"
     */
    applyPenalty(
        action: Action,
        ctx: { clock: string; gridPrice: number; weatherTemperature: number }
    ): Guideline {
        const hour = parseInt(ctx.clock.split(':')[0] ?? '0', 10);

        const decisionContext: DecisionContext = {
            simulator: {
                clock: ctx.clock,
                gridPrice: ctx.gridPrice,
                weatherTemperature: ctx.weatherTemperature,
            },
            external: null,
        };

        const dims = orderDimensionsByUrgency(decisionContext);
        const dominant = dims[0] ?? 'Grid_Price';

        let text: string;

        if (dominant === 'Grid_Price') {
            if (ctx.gridPrice >= 0.34) {
                text = `Do not ${action} when Grid_Price >= ${ctx.gridPrice.toFixed(2)}`;
            } else if (ctx.gridPrice <= 0.09) {
                text = `Do not ${action} when Grid_Price <= ${ctx.gridPrice.toFixed(2)}`;
            } else {
                text = `Do not ${action} when Grid_Price >= ${ctx.gridPrice.toFixed(2)}`;
            }
        } else if (dominant === 'Weather_Temperature') {
            if (ctx.weatherTemperature >= 82) {
                text = `Do not ${action} when Temperature >= ${Math.round(ctx.weatherTemperature)}`;
            } else if (ctx.weatherTemperature <= 48) {
                text = `Do not ${action} when Temperature <= ${Math.round(ctx.weatherTemperature)}`;
            } else {
                text = `Do not ${action} when Temperature >= ${Math.round(ctx.weatherTemperature)}`;
            }
        } else {
            // Clock or fallback
            if (hour >= 17 && hour <= 21) {
                text = `Do not ${action} when Clock_Hour >= 17`;
            } else if (hour >= 23 || hour <= 5) {
                text = `Do not ${action} when Clock_Hour <= 5`;
            } else if (hour >= 11 && hour <= 15) {
                text = `Do not ${action} when Clock_Hour >= 11`;
            } else {
                text = `Do not ${action} when Clock_Hour >= ${hour}`;
            }
        }

        return {
            id: uuidv4(),
            text,
            createdAt: new Date().toISOString(),
            timesApplied: 0,
        };
    }
}

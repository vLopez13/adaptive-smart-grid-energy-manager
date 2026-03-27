import type { AgentDecision, DecisionContext } from '../types/energy';
import { listProposalsInOrder } from './decisionPolicy';
import { isActionAllowedByGuidelines, type PreferenceGuideline } from './PreferenceGuideline';

export class EnergyAgent {
    constructor(private guidelines: PreferenceGuideline[] = []) {}

    getGuidelines(): readonly PreferenceGuideline[] {
        return this.guidelines;
    }

    setGuidelines(next: PreferenceGuideline[]): void {
        this.guidelines = next;
    }

    /**
     * One decision cycle: propose from streams + external context, then apply guidelines.
     */
    decide(context: DecisionContext): AgentDecision {
        try {
            for (const proposal of listProposalsInOrder(context)) {
                if (isActionAllowedByGuidelines(proposal.action, context, this.guidelines)) {
                    return proposal;
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
}

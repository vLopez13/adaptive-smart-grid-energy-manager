import type { Action, DecisionContext } from '../types/energy';

/**
 * User-learned constraint (Requirement 5). When `applies` is true, `excludedAction`
 * is removed from the candidate set for that cycle.
 */
export interface PreferenceGuideline {
    id: string;
    excludedAction: Action;
    applies: (context: DecisionContext) => boolean;
}

export function isActionAllowedByGuidelines(
    action: Action,
    context: DecisionContext,
    guidelines: readonly PreferenceGuideline[]
): boolean {
    for (const g of guidelines) {
        if (g.excludedAction !== action) {
            continue;
        }
        if (g.applies(context)) {
            return false;
        }
    }
    return true;
}

/** Actions the Agent may issue (Requirement 2). */
export type Action =
    | 'SELL_TO_GRID'
    | 'BUY_FROM_GRID'
    | 'STORE_IN_BATTERY'
    | 'DISCHARGE_BATTERY'
    | 'SHUT_OFF_AC'
    | 'RESTORE_AC'
    | 'CHARGE_EV_NOW'
    | 'PAUSE_EV_CHARGING';

/** Dashboard / logging: primary driver must be one of the three simulated streams. */
export type PrimaryReason = 'Grid_Price' | 'Weather_Temperature' | 'Clock';

export interface SimulatorSnapshot {
    clock: string;
    gridPrice: number;
    weatherTemperature: number;
}

/** Latest row from `public.test` (Airbyte-synced); shape varies by source. */
export type ExternalContextRow = Record<string, unknown> | null;

export interface DecisionContext {
    simulator: SimulatorSnapshot;
    external: ExternalContextRow;
}

export interface AgentDecision {
    action: Action;
    primaryReason: PrimaryReason;
    /** Human-readable explanation (may mention external fields). */
    reasonDetail: string;
}

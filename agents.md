# Agent Architecture

The **Agent** acts as the central intelligence of the Adaptive Smart-Grid Energy Manager. It processes real-time data from the `DataStreamSimulator` and autonomously makes energy routing decisions based on its built-in logic and user-defined constraints.

## Core Responsibilities

1. **Continuous Evaluation:** Listens to `DataStreamSimulator` inputs (`Clock`, `Grid_Price`, `Weather_Temperature`) and re-evaluates the optimal action on every tick.
2. **Action Dispatching:** Selects exactly one action per cycle from the following list:
   - `SELL_TO_GRID`
   - `BUY_FROM_GRID`
   - `STORE_IN_BATTERY`
   - `DISCHARGE_BATTERY`
   - `SHUT_OFF_AC`
   - `RESTORE_AC`
   - `CHARGE_EV_NOW`
   - `PAUSE_EV_CHARGING`
3. **Logging & Execution:** Fully logs the executed action alongside its reasoning (e.g., Grid Price was too high, so it chose `SHUT_OFF_AC`).

## Preference Learning Engine

The agent features an adaptive *learning loop* driven by negative reinforcement:

- **Overrides:** If a user manually overrides an agent decision via the Dashboard, the agent cancels the action and restores the system state.
- **Penalties:** During an override, the agent receives a *Penalty* signal containing the contextual data streams at that exact moment.
- **Guidelines:** The agent converts Penalties into persistent `Preference_Guidelines` (e.g., "Do not SHUT_OFF_AC if Weather_Temperature > 90°F"). These constraints act as filters during future decision cycles, effectively stopping the agent from making the same "mistake" again.

## Error Handling
The Agent must gracefully handle:
- **Stale Data:** Reverts to the last known valid stream data if the simulator times out.
- **Storage Failures:** Starts with a fresh memory if persistent Preference Storage cannot be loaded.
- **Decision Errors:** Uses a unified try-catch boundary so it never fully halts the application on an unhandled exception.

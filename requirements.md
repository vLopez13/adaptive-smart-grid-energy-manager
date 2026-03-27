# Requirements Document

## Introduction

The Adaptive Smart-Grid Energy Manager is an AI-driven home energy management system that controls a home's solar battery. The system continuously monitors simulated data streams (time of day, grid electricity price, and outdoor temperature) and autonomously decides whether to store solar energy, use it to power the home, or sell it back to the grid. The system executes actions such as selling power, adjusting HVAC, or charging an EV. A key feature is an on-the-fly learning loop: when a user overrides an agent decision, the agent receives a penalty and updates its internal preference guidelines to better reflect user priorities in future decisions. A real-time UI displays system state, active decisions, and provides override controls.

---

## Glossary

- **Agent**: The AI decision-making component that evaluates data streams and selects energy actions.
- **Battery**: The home's solar battery storage unit (simulated).
- **Grid**: The external electrical utility grid to which power can be sold or purchased.
- **Grid_Price**: The simulated, randomized current price of electricity on the grid (in $/kWh).
- **Weather_Temperature**: The simulated, randomized current outdoor temperature (in °F).
- **Clock**: The simulated current time of day (HH:MM, 24-hour format).
- **Action**: A discrete command the Agent can issue (e.g., `SELL_TO_GRID`, `SHUT_OFF_AC`, `CHARGE_EV_NOW`).
- **Override**: A user-initiated cancellation of an Agent-issued Action.
- **Penalty**: A negative reinforcement signal applied to the Agent when the user issues an Override.
- **Preference_Guidelines**: The Agent's internal, updateable ruleset that encodes learned user preferences derived from Penalties.
- **Dashboard**: The web UI that displays system state, active decisions, and Override controls.
- **Data_Stream_Simulator**: The component that generates randomized, time-varying values for Grid_Price, Weather_Temperature, and Clock.

---

## Requirements

### Requirement 1: Data Stream Simulation

**User Story:** As a developer, I want simulated data streams for time, grid price, and temperature, so that the system can operate and be tested without real hardware.

#### Acceptance Criteria

1. THE Data_Stream_Simulator SHALL emit a Clock value representing the current simulated time of day in HH:MM (24-hour) format.
2. THE Data_Stream_Simulator SHALL emit a Grid_Price value in the range of $0.05/kWh to $0.50/kWh, updated at a configurable interval of no less than 1 second.
3. THE Data_Stream_Simulator SHALL emit a Weather_Temperature value in the range of 20°F to 115°F, updated at a configurable interval of no less than 1 second.
4. WHEN the Data_Stream_Simulator is started, THE Data_Stream_Simulator SHALL initialize all three streams with valid values before the Agent begins its first decision cycle.

---

### Requirement 2: Agent Decision Cycle

**User Story:** As a homeowner, I want the Agent to automatically evaluate current conditions and issue energy actions, so that my home's energy usage is optimized without manual intervention.

#### Acceptance Criteria

1. WHEN a new value is emitted by any Data_Stream, THE Agent SHALL evaluate the current Grid_Price, Weather_Temperature, and Clock to determine the optimal Action.
2. THE Agent SHALL select exactly one Action per decision cycle from the defined Action set: `SELL_TO_GRID`, `BUY_FROM_GRID`, `STORE_IN_BATTERY`, `DISCHARGE_BATTERY`, `SHUT_OFF_AC`, `RESTORE_AC`, `CHARGE_EV_NOW`, `PAUSE_EV_CHARGING`.
3. WHEN the Agent selects an Action, THE Agent SHALL apply all active Preference_Guidelines before finalizing the Action.
4. WHEN the Agent issues an Action, THE Dashboard SHALL display the Action and the primary reason (Grid_Price, Weather_Temperature, or Clock) within 500ms.

---

### Requirement 3: Action Execution

**User Story:** As a homeowner, I want the Agent's decisions to result in concrete commands to home systems, so that energy is actually managed according to the Agent's choices.

#### Acceptance Criteria

1. WHEN the Agent issues `SELL_TO_GRID`, THE Agent SHALL log the Grid_Price at the time of the action and the estimated revenue.
2. WHEN the Agent issues `SHUT_OFF_AC`, THE Agent SHALL log the Weather_Temperature and Grid_Price at the time of the action.
3. WHEN the Agent issues `CHARGE_EV_NOW`, THE Agent SHALL log the Grid_Price and Clock at the time of the action.
4. THE Agent SHALL log every issued Action with a timestamp, the triggering data stream values, and the active Preference_Guidelines that influenced the decision.

---

### Requirement 4: User Override

**User Story:** As a homeowner, I want to override any Agent decision I disagree with, so that I retain control over my home's systems.

#### Acceptance Criteria

1. WHEN the Agent issues an Action, THE Dashboard SHALL display an Override button associated with that Action within 500ms.
2. WHEN the user activates the Override button, THE Agent SHALL immediately cancel the current Action and restore the previous system state.
3. WHEN the user activates the Override button, THE Agent SHALL receive a Penalty signal containing the overridden Action, the data stream values at the time of the decision, and the active Preference_Guidelines at the time of the decision.
4. WHILE an Override is being processed, THE Dashboard SHALL display a confirmation that the Override was received and the Action was cancelled.

---

### Requirement 5: Preference Learning

**User Story:** As a homeowner, I want the Agent to learn from my overrides, so that it stops making decisions I disagree with under similar conditions in the future.

#### Acceptance Criteria

1. WHEN the Agent receives a Penalty, THE Agent SHALL generate a new Preference_Guideline that encodes the relationship between the overridden Action and the conditions present at the time of the decision.
2. WHEN the Agent generates a new Preference_Guideline, THE Agent SHALL store the guideline in persistent storage so that it survives application restarts.
3. WHEN the Agent generates a new Preference_Guideline, THE Dashboard SHALL display the new guideline in plain language within 1 second (e.g., "User prioritizes temperature comfort over financial savings when outdoor temperature exceeds 90°F").
4. WHEN the Agent evaluates a new decision cycle and an active Preference_Guideline applies to the current conditions, THE Agent SHALL exclude the penalized Action from the candidate Action set for that cycle.
5. THE Agent SHALL maintain a Preference_Guidelines log that records each guideline, the date it was created, and the number of times it has been applied.

---

### Requirement 6: Dashboard Display

**User Story:** As a homeowner, I want a real-time dashboard showing current conditions, active decisions, and learned preferences, so that I can understand and trust the system's behavior.

#### Acceptance Criteria

1. THE Dashboard SHALL display the current Clock, Grid_Price, and Weather_Temperature values, refreshed within 1 second of a new Data_Stream value being emitted.
2. THE Dashboard SHALL display the most recent Action issued by the Agent and the reason for the decision.
3. THE Dashboard SHALL display all active Preference_Guidelines in a human-readable list.
4. THE Dashboard SHALL display a history of the last 20 Actions issued by the Agent, including timestamps and triggering conditions.
5. WHEN no Action has been issued yet, THE Dashboard SHALL display a "Waiting for first decision" status message.
6. IF the Agent fails to complete a decision cycle within 2 seconds of a data stream update, THEN THE Dashboard SHALL display a "Decision timeout" warning.

---

### Requirement 7: Preference Guideline Management

**User Story:** As a homeowner, I want to review and remove learned preferences, so that I can correct the Agent if it learned something wrong.

#### Acceptance Criteria

1. THE Dashboard SHALL display each Preference_Guideline with a delete control.
2. WHEN the user deletes a Preference_Guideline, THE Agent SHALL remove the guideline from the active Preference_Guidelines set immediately.
3. WHEN the user deletes a Preference_Guideline, THE Agent SHALL remove the guideline from persistent storage so that it does not reappear after an application restart.
4. WHEN all Preference_Guidelines have been deleted, THE Agent SHALL revert to its default decision logic for all subsequent decision cycles.

---

### Requirement 8: System Resilience

**User Story:** As a homeowner, I want the system to handle errors gracefully, so that a failure in one component does not bring down the entire application.

#### Acceptance Criteria

1. IF the Data_Stream_Simulator fails to emit a value within 5 seconds of the expected interval, THEN THE Agent SHALL use the last known valid value for that stream and THE Dashboard SHALL display a "Stale data" warning for the affected stream.
2. IF the persistent storage for Preference_Guidelines is unavailable at startup, THEN THE Agent SHALL start with an empty Preference_Guidelines set and THE Dashboard SHALL display a "Preferences unavailable" warning.
3. IF the Agent encounters an unhandled error during a decision cycle, THEN THE Agent SHALL log the error with full context and THE Dashboard SHALL display a "Decision error" status without crashing.

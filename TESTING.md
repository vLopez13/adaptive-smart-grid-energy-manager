# Testing Guide — Adaptive Smart-Grid Energy Manager

## Quick Start

```bash
npm test                  # All 41 unit tests
npm run server            # Start dashboard at http://localhost:3000
```

---

## Unit Tests

Run the full suite:

```bash
npm test
```

Run a single file:

```bash
npm test -- --testPathPattern=decisionPolicy
npm test -- --testPathPattern=guidelineAdapter
npm test -- --testPathPattern=DataStreamSimulator
npm test -- --testPathPattern=GuidelinesStore
```

### What's covered

| File | Tests | What it verifies |
|---|---|---|
| `DataStreamSimulator.test.ts` | 8 | Tick interval, clock advance, price/temp clamping, event emission |
| `decisionPolicy.test.ts` | 19 | Urgency scoring, dimension ordering, all 8 action proposals, boundary values |
| `guidelineAdapter.test.ts` | 8 | Guideline text parsing, operator support, silent drop of bad entries |
| `GuidelinesStore.test.ts` | 6 | DB load/add/remove/increment, silent failure on DB unavailable |

---

## Agent Decision Flows

The agent scores three dimensions — **Weather_Temperature**, **Grid_Price**, **Clock** — and picks the highest-urgency one. The tables below show which conditions trigger each action.

### Flow 1: Grid Price dominates

| Condition | Urgency | Action |
|---|---|---|
| Price ≥ $0.42/kWh | 100 | `SELL_TO_GRID` (export while rates are high) |
| Price ≥ $0.42/kWh + battery < 18% | 100 | `STORE_IN_BATTERY` (battery too low to sell) |
| Price ≥ $0.34/kWh | 75 | `SELL_TO_GRID` |
| Price ≥ $0.26/kWh | 45 | `DISCHARGE_BATTERY` |
| Price $0.10–$0.25/kWh | 0 | `STORE_IN_BATTERY` (moderate, save for later) |
| Price ≤ $0.09/kWh | 95 | `BUY_FROM_GRID` (cheap power, import now) |

**To observe in the dashboard:** wait for the simulator to walk the price above $0.34. The action badge turns green and shows `SELL TO GRID` with price reasoning.

### Flow 2: Temperature dominates

| Condition | Urgency | Action |
|---|---|---|
| Temp ≥ 95°F | 100 | `SHUT_OFF_AC` (extreme heat, shed HVAC load) |
| Temp ≥ 88°F | 70 | `PAUSE_EV_CHARGING` (warm, defer flexible loads) |
| Temp ≥ 82°F | 40 | `PAUSE_EV_CHARGING` |
| Temp 37–81°F | 0 | `RESTORE_AC` (comfortable, maintain settings) |
| Temp ≤ 40°F | 65 | `RESTORE_AC` (cold, restore heating) |
| Temp ≤ 32°F | 95 | `RESTORE_AC` (freezing emergency) |

**To observe:** temperature walks slowly (20–115°F range). You can speed-test via unit tests or adjust simulator bounds in `DataStreamSimulator.ts`.

### Flow 3: Clock (time-of-day) dominates

| Time window | Urgency | Action |
|---|---|---|
| 17:00–21:59 (peak) | 85 | `PAUSE_EV_CHARGING` (avoid demand charges) |
| 23:00–05:59 (off-peak) + EV connected | 55 | `CHARGE_EV_NOW` (shift to cheap hours) |
| 23:00–05:59 (off-peak) + EV not connected | 55 | `STORE_IN_BATTERY` |
| 11:00–15:59 (midday solar) | 40 | `STORE_IN_BATTERY` (capture solar) |
| All other hours | 0 | `CHARGE_EV_NOW` (opportunistic) |

**To observe in the dashboard:** the simulator clock advances 15 simulated minutes per real second. Start at 08:00 — within about 1 minute of real time the clock reaches the 17:00 peak window and the action switches to `PAUSE EV CHARGING`.

### Flow 4: Tie-breaking (all urgency = 0)

When price is $0.10–$0.25, temp is 41–81°F, and clock is 06:00–10:59 or 16:00–16:59, all three urgency scores are 0. The agent defaults to:

```
Grid_Price → Weather_Temperature → Clock
```

So the first proposal is always economics-based (`STORE_IN_BATTERY` at moderate price).

### Flow 5: Guideline blocks first-choice action

When a `Preference_Guideline` excludes the top-ranked action, the agent falls through to the next proposal in urgency order. If all three are blocked, the fallback is `STORE_IN_BATTERY`.

**Example scenario:**

1. Price = $0.40 → first choice is `SELL_TO_GRID`
2. Guideline: `Do not SELL_TO_GRID when Grid_Price < 0.50`
3. Agent skips `SELL_TO_GRID`, moves to next proposal (Clock or Weather_Temperature)

To test this end-to-end, POST a guideline to the server and observe the dashboard action change:

```bash
# Add a guideline via Ghost DB / GuidelinesStore
# (direct DB insert or future POST /api/guidelines endpoint)
```

---

## Dashboard UI Flows

Start the server, open `http://localhost:3000`.

### Flow A: Live data updates

1. Open the dashboard — the `init` SSE event pre-populates all three stream cards and action history.
2. Watch Clock, Grid Price, and Temperature cards update every second.
3. Confirm the reasoning text in the Current Agent Decision card changes to match the dominant dimension.

### Flow B: Override

1. Wait for an action to appear in the Current Agent Decision card.
2. Click the **Override** button (top-right of the card).
3. **Expected:** action card clears / dims; the server logs `User Override requested!`; `override_success` event received; SSE stream continues uninterrupted.
4. Within one tick (~1 second) the agent issues the next decision.

### Flow C: Stale data warning

The server checks every 2 seconds whether any stream has been silent for > 5 seconds.

To trigger manually: stop the simulator process or disconnect the SSE client, wait 6 seconds, then reconnect. The dashboard should show a **STALE** badge on the affected stream card.

### Flow D: Decision timeout warning

If the agent has not issued a decision within 2 seconds of the last stream update, a timeout warning appears. This can happen if the Ghost Postgres call is slow.

To trigger: set `DATABASE_URL` to an unreachable host and restart the server. The Postgres call will hang until timeout, firing the `decision_timeout` SSE event.

### Flow E: Preferences unavailable banner

If the `preference_guidelines` table is empty or Ghost DB is unreachable at startup, the banner `Preferences unavailable` appears at the top of the page.

---

## External Context (Airbyte / Postgres)

The agent reads one optional row from the Postgres table configured by `AIRBYTE_TABLE` (default: `public.test`). This row may carry:

| Column | Effect |
|---|---|
| `battery_level` or `batteryLevel` | Float 0–1; if < 0.18 when price ≥ $0.34, agent prefers `STORE_IN_BATTERY` over `SELL_TO_GRID` |
| `ev_connected` or `evConnected` | Boolean; false switches off-peak action from `CHARGE_EV_NOW` to `STORE_IN_BATTERY` |

To test with real external context:

```bash
# Insert a test row into Ghost Postgres
psql $DATABASE_URL -c "INSERT INTO public.test (battery_level, ev_connected) VALUES (0.05, true);"
```

If Postgres is unreachable, `fetchLatestExternalContextSafe` returns `null` and the agent uses simulator-only context (no error thrown).

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Ghost Postgres connection string |
| `AIRBYTE_TABLE` | `test` | Postgres table for external context |
| `PORT` | `3000` | Express server port |

---

## Urgency Scoring Reference

Quick lookup for writing test scenarios:

```
Weather_Temperature urgency:
  ≥ 95°F  → 100   ≤ 32°F  → 95
  ≥ 88°F  →  70   ≤ 40°F  → 65
  ≥ 82°F  →  40   ≤ 48°F  → 35
  else    →   0

Grid_Price urgency:
  ≥ $0.42 → 100   ≤ $0.07 → 95
  ≥ $0.32 →  75   ≤ $0.10 → 70
  ≥ $0.26 →  45
  else    →   0

Clock urgency:
  17–21   →  85
  23–05   →  55
  11–15   →  40
  else    →   0

Tie-break order (same urgency): Weather_Temperature > Grid_Price > Clock
```

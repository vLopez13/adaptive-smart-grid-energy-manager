# Adaptive Smart-Grid Energy Manager

An AI-driven home energy management system that autonomously controls a home's solar battery. It monitors real-time simulated data streams — time of day, grid electricity price, and outdoor temperature — and makes continuous decisions about whether to store solar energy, power the home, or sell back to the grid. Users can override any decision, and the agent learns from those overrides to align with their preferences over time.

---

## Features

- **Real-time data simulation** — Clock, Grid Price, and Weather Temperature streams updated on a configurable interval
- **Autonomous agent decisions** — Selects the optimal energy action every cycle from 8 possible commands
- **Preference learning** — Converts user overrides into persistent guidelines that shape future decisions
- **Live dashboard** — SSE-powered web UI displaying streams, active decisions, override controls, and learned preferences
- **Resilient by design** — Handles stale data, storage failures, and decision errors without crashing

---

## Actions

The agent selects exactly one action per decision cycle:

| Action | Description |
|--------|-------------|
| `SELL_TO_GRID` | Export stored solar energy to the grid |
| `BUY_FROM_GRID` | Purchase electricity from the grid |
| `STORE_IN_BATTERY` | Charge the home battery with solar energy |
| `DISCHARGE_BATTERY` | Draw power from the battery |
| `SHUT_OFF_AC` | Turn off HVAC to reduce load |
| `RESTORE_AC` | Re-enable HVAC |
| `CHARGE_EV_NOW` | Charge the electric vehicle |
| `PAUSE_EV_CHARGING` | Pause EV charging |

---

## Architecture

```
DataStreamSimulator
  └── emits: Clock, Grid_Price, Weather_Temperature
        │
        ▼
      Agent
  ├── evaluates streams each tick
  ├── applies active Preference Guidelines
  ├── selects + logs one Action
  └── receives Penalty on user Override
        │
        ▼
  Preference Engine
  ├── generates human-readable guidelines
  └── persists to storage
        │
        ▼
  Express Server (SSE)
        │
        ▼
  Dashboard (browser)
  ├── live stream display
  ├── current decision + Override button
  ├── preference guidelines list
  └── last 20 action history
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Run the dashboard

```bash
npm run server
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Run tests

```bash
npm test
```

### Run the simulator demo (CLI)

```bash
npm start
```

---

## Project Structure

```
src/
  simulator/
    DataStreamSimulator.ts   # Emits Clock, Grid_Price, Weather_Temperature
  server.ts                  # Express + SSE server, REST override/guideline endpoints
  demo.ts                    # CLI demo for the simulator
public/
  index.html                 # Dashboard layout
  app.js                     # SSE client + DOM rendering
  style.css                  # Dark-mode UI styles
```

---

## Data Streams

| Stream | Range | Unit |
|--------|-------|------|
| `Clock` | 00:00 – 23:59 | HH:MM (24h simulated time) |
| `Grid_Price` | $0.05 – $0.50 | $/kWh |
| `Weather_Temperature` | 20 – 115 | °F |

All streams initialize with valid values before the agent begins its first decision cycle.

---

## Preference Learning

When a user overrides an agent decision, the agent:

1. Cancels the action and restores the previous system state
2. Receives a **Penalty** containing the action, data stream values, and active guidelines at that moment
3. Generates a new **Preference Guideline** in plain language (e.g., *"Do not SHUT_OFF_AC when Temperature > 90°F"*)
4. Persists the guideline so it survives restarts
5. Excludes the penalized action from future cycles when the same conditions apply

Guidelines can be reviewed and deleted from the dashboard at any time.

---

## Requirements Status

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Data Stream Simulation | Complete |
| 2 | Agent Decision Cycle | Pending |
| 3 | Action Execution | Pending |
| 4 | User Override | Pending |
| 5 | Preference Learning | Pending |
| 6 | Dashboard Display | In Progress |
| 7 | Preference Guideline Management | Pending |
| 8 | System Resilience | Pending |

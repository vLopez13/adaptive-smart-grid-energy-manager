<div align="center">

# Adaptive Smart-Grid Energy Manager

**An autonomous home energy agent** that reads live (simulated) grid, weather, and time streams, ingests **Airbyte-synced context from Postgres**, and issues exactly **one** optimal action every cycle - sell, buy, store, discharge, HVAC, or EV, while **learning from your overrides** through persistent preference guidelines.

<br/>

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)

<br/>

</div>

---

**Hackathon:** Deep Agents Hackathon<br/>
**Team:** Logesh Rajendran, Vanessa Lopez, Volodymyr Borysenko<br/>
**Live demo:** *Run locally →* [`http://localhost:3000`](http://localhost:3000) *(after `npm run server`)*

---

## The Problem

Home energy is **dynamic**: electricity prices spike, weather shifts comfort needs, and time-of-use rates reward shifting EV charging and storage — but most households still **react manually** or run dumb schedules.

**This project is a production-style agent loop**: it continuously evaluates **Clock**, **Grid_Price**, and **Weather_Temperature**, layers in **latest external context** already landed in **Postgres** (synced upstream by **Airbyte Cloud** - the app never calls Airbyte inside the decision tick), applies **learned preference guidelines**, picks **one** command from a fixed action set, and surfaces everything on a **real-time dashboard** with overrides and audit logging.

---

## Built With

| Area | Stack |
|------|--------|
| **Runtime** | Node.js · TypeScript · `ts-node` |
| **API & realtime** | Express 5 · CORS · **Server-Sent Events (SSE)** |
| **Data** | `pg` · PostgreSQL (Airbyte destination + optional guideline storage) |
| **Ingestion (upstream)** | Airbyte Cloud → Postgres `public.test` *(read-only in the agent loop)* |
| **Testing** | Jest · ts-jest |

---

## Architecture at a Glance

```mermaid
flowchart LR
    subgraph SIM["Simulation"]
        DS[DataStreamSimulator]
    end

    subgraph CTX["External context"]
        AB[Airbyte Cloud]
        PG[(PostgreSQL)]
        AB -->|"sync"| PG
    end

    subgraph AGENT["Energy Agent"]
        E[decisionPolicy + guidelines]
    end

    subgraph UI["Dashboard"]
        WEB[Browser · SSE]
    end

    DS -->|"tick: clock, price, temp"| E
    PG -->|"latest row from public.test"| E
    E -->|"action + reason"| WEB
    WEB -->|"override"| E
```

### End-to-end decision cycle

```mermaid
sequenceDiagram
    participant Sim as Simulator
    participant PG as Postgres
    participant Agent as EnergyAgent
    participant UI as Dashboard

    Sim->>Sim: emit tick (snapshot)
    Sim->>PG: read latest Airbyte row (safe fallback)
    PG-->>Agent: external context (or null)
    Agent->>Agent: rank proposals · apply guidelines
    Agent-->>UI: SSE: action, history, streams
    UI->>Agent: POST override → penalty → new guideline
```

---

## The Energy Agent

Every **tick** (after each full stream update), the agent:

1. Loads **optional** Postgres context (latest row from `public.test`, column order resolved via introspection — e.g. `_airbyte_extracted_at`).
2. Builds **ordered candidate decisions** from **Grid_Price**, **Weather_Temperature**, and **Clock** urgency (plus hints like `battery_level` / `ev_connected` when present in the row).
3. **Filters** candidates using **active preference guidelines** (parsed from persistent storage).
4. **Selects exactly one** `Action` and logs structured output via `ActionLogger` / `ErrorLogger`.

If Postgres is down or misconfigured, the agent **falls back to simulator-only** context and keeps running.

### Actions (one per cycle)

| Action | Intent |
|--------|--------|
| `SELL_TO_GRID` | Export stored energy when rates are favorable |
| `BUY_FROM_GRID` | Import when power is cheap |
| `STORE_IN_BATTERY` | Charge storage |
| `DISCHARGE_BATTERY` | Use stored energy |
| `SHUT_OFF_AC` / `RESTORE_AC` | HVAC load management |
| `CHARGE_EV_NOW` / `PAUSE_EV_CHARGING` | EV scheduling (respects EV connectivity from external row when available) |

---

## Dashboard

- **SSE** stream at `/api/stream` — live clock, price, temperature, latest action, history (last 20), guidelines.
- **Override** — `POST /api/override` cancels the current action and feeds a **penalty** into the agent to mint a **new guideline**.
- **Guideline management** — `DELETE /api/guidelines/:id`; guidelines stored in Postgres when `DATABASE_URL` is set.

Static assets live under `public/` (`index.html`, `app.js`, `style.css`).

---

## What Makes This an “Agent”?

This project isn’t a single LLM call — it’s an **agentic control loop**:

| Property | How it shows up here |
|----------|----------------------|
| **Perceives** | Continuous streams + optional Postgres snapshot |
| **Decides** | Deterministic policy + urgency ordering + guideline gating |
| **Acts** | Exactly one discrete action per cycle, with primary reason (Grid / Weather / Clock) |
| **Learns from feedback** | Overrides → penalties → persisted guidelines that exclude actions under similar conditions |
| **Resilient** | Postgres optional; errors logged; stale-data and decision-timeout signals to the UI |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Language** | TypeScript (strict) |
| **HTTP** | Express 5, JSON body, static `public/` |
| **Realtime** | Server-Sent Events |
| **Database** | PostgreSQL via `pg` (Airbyte context table + `preference_guidelines` table) |
| **Config** | `dotenv` |
| **IDs** | `uuid` / `crypto.randomUUID` |

---

## Project Structure

```
tokens-hackathon/
├── src/
│   ├── agent/
│   │   ├── EnergyAgent.ts          # decide() · applyPenalty() · guideline tracking
│   │   ├── decisionPolicy.ts       # urgency + proposals + external hints
│   │   ├── PreferenceGuideline.ts  # blocking rules
│   │   └── guidelineAdapter.ts     # persisted guidelines ↔ runtime rules
│   ├── context/
│   │   ├── postgresPublicTest.ts   # introspect public.test · latest row
│   │   └── externalFieldHelpers.ts
│   ├── simulator/
│   │   └── DataStreamSimulator.ts  # streams + tick payload
│   ├── store/
│   │   ├── GuidelinesStore.ts      # Postgres persistence
│   │   ├── ActionLogger.ts
│   │   └── ErrorLogger.ts
│   ├── types/energy.ts
│   ├── server.ts                   # Express + SSE + REST
│   └── demo.ts                     # CLI simulator (no server)
├── public/                         # Dashboard (HTML/CSS/JS)
├── scripts/
│   └── inspect-public-test.ts      # print columns + sample row from public.test
├── requirements.md
├── agents.md
└── package.json
```

---

## Quick Start

```bash
git clone <your-repo-url>
cd tokens-hackathon
npm install
```

### Environment variables

Create a `.env` in the project root (loaded by `dotenv` when you run the server):

```bash
# Server
PORT=3000

# PostgreSQL — used for:
#   • GuidelinesStore (preference_guidelines table)
#   • Same pool can back read of public.test Airbyte context (see src/context/postgresPublicTest.ts)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

If `DATABASE_URL` is missing, guideline persistence may fail — check the dashboard for a **preferences unavailable** style warning. **Airbyte** is never called from the app; it only syncs into Postgres ahead of time.

### Inspect your Airbyte table (optional)

```bash
npm run inspect:pg
```

Prints `public.test` columns, the chosen `ORDER BY` column, and the latest row.

### Run the web dashboard

```bash
npm run server
```

Open **[http://localhost:3000](http://localhost:3000)**.

### Run the CLI demo (streams + agent log line only)

```bash
npm start
```

### Tests

```bash
npm test
```

---

## Roadmap / Requirements

See `requirements.md` for the full spec (data simulation, decision cycle, execution logging, overrides, preference learning, dashboard, resilience). This README is the **elevator pitch**; the repo tracks detailed acceptance criteria.

---

<div align="center">

**Built with TypeScript, Express, Postgres, and a tight feedback loop between humans and their agents.**

</div>

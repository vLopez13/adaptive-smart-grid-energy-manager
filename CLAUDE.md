# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                        # Run all Jest tests
npm test -- --testPathPattern=DataStreamSimulator   # Run a single test file
npm start                       # Run the CLI simulator demo (src/demo.ts)
npx ts-node src/server.ts       # Start the Express dashboard server (port 3000)
npx tsc --noEmit                # Type-check without emitting
```

Note: `express` and `cors` (+ their `@types`) are not yet in `package.json` — `src/server.ts` will not compile until they are added.

## Architecture

The system has three layers that haven't been fully connected yet:

**1. Data Layer — `src/simulator/DataStreamSimulator.ts`**
Extends Node's `EventEmitter`. Call `.start()` to begin emitting `clock` (HH:MM string), `grid_price` (number), and `weather_temperature` (number) on a configurable interval. All three streams are emitted synchronously per tick. The constructor enforces a minimum 1000ms interval.

**2. Server Layer — `src/server.ts`**
Express server that instantiates `DataStreamSimulator`, bridges its events onto an internal `EventEmitter` (`streamBus`), and pushes everything to browser clients via SSE at `GET /api/stream`. The Agent (Req 2) does not exist yet — a `setInterval` mock randomly picks actions every 7 seconds as a stand-in. REST endpoints: `POST /api/override`, `DELETE /api/guidelines/:id`. The file uses `// @ts-nocheck` and should have that removed when the real Agent is wired in.

**3. Frontend — `public/`**
Vanilla JS (`app.js`) connects to the SSE endpoint and updates the DOM. No build step. The `init` event sent on SSE connection carries full current state. Subsequent events are typed: `clock`, `grid_price`, `weather_temperature`, `action_issued`, `history_updated`, `guidelines_updated`, `override_success`.

## What's Not Built Yet

Requirements 2–5 and 7–8 are pending. The next task is **Requirement 2: Agent Decision Cycle** — a class that listens to `DataStreamSimulator` events, selects one of the 8 defined actions, applies `Preference_Guidelines` as filters, and emits the result. See `requirements.md` for full acceptance criteria and `agents.md` for the intended agent architecture.

## Key Constraints

- `updateIntervalMs` must be ≥ 1000ms (enforced in constructor)
- `Grid_Price` walks randomly within `$0.05–$0.50`; `Weather_Temperature` within `20–115°F` — both use a random-walk clamped model, not pure random
- TypeScript strict mode is on; `tsconfig.json` targets ES2016 CommonJS
- Tests use `jest.useFakeTimers()` to advance the simulator interval — follow this pattern for any time-dependent tests

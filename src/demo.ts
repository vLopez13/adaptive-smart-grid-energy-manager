import { EnergyAgent } from './agent/EnergyAgent';
import { fetchLatestExternalContextSafe, resolvePostgresContextConfig } from './context/postgresPublicTest';
import type { TickPayload } from './simulator/DataStreamSimulator';
import { DataStreamSimulator } from './simulator/DataStreamSimulator';

const SLACK_MS = 500;

const simulator = new DataStreamSimulator({
    updateIntervalMs: 1000,
    timeSpeedMinutesPerUpdate: 15,
    startClock: '08:00',
});

const agent = new EnergyAgent([]);
const pg = resolvePostgresContextConfig();

if (pg.enabled && pg.pool) {
    console.log('Postgres context enabled (latest row from public.test).');
} else {
    console.log('Postgres not configured — using simulator-only context (DATABASE_URL / PG* env vars).');
}

console.log('Starting Smart-Grid Environment Simulation...');
console.log('---------------------------------------------');

simulator.on('tick', async (payload: TickPayload) => {
    const t0 = Date.now();
    const ext = await fetchLatestExternalContextSafe(pg.pool);
    const decision = agent.decide({
        simulator: {
            clock: payload.clock,
            gridPrice: payload.gridPrice,
            weatherTemperature: payload.weatherTemperature,
        },
        external: ext.row,
    });
    const elapsed = Date.now() - t0;
    const line = `[${payload.clock}] $${payload.gridPrice.toFixed(3)}/kWh | ${payload.weatherTemperature.toFixed(1)}°F | Action: ${decision.action} | Reason: ${decision.primaryReason} | ${decision.reasonDetail}`;
    process.stdout.write(`\r${line.padEnd(118)}`);
    if (elapsed > SLACK_MS) {
        console.warn(`\n[warn] Decision + dashboard update took ${elapsed}ms (target ≤ ${SLACK_MS}ms).`);
    }
});

process.on('SIGINT', () => {
    console.log('\nStopping simulation...');
    simulator.stop();
    void pg.pool?.end();
    process.exit(0);
});

simulator.start();

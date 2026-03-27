import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { join } from 'path';
import { auth, requiresAuth } from 'express-openid-connect';
import { DataStreamSimulator, type TickPayload } from './simulator/DataStreamSimulator';
import { GuidelinesStore, type Guideline } from './store/GuidelinesStore';
import { EnergyAgent } from './agent/EnergyAgent';
import { toPreferenceGuidelines } from './agent/guidelineAdapter';
import { resolvePostgresContextConfig, fetchLatestExternalContextSafe } from './context/postgresPublicTest';
import { EventEmitter } from 'events';
import type { Action } from './types/energy';
import { ActionLogger } from './store/ActionLogger';
import { ErrorLogger } from './store/ErrorLogger';
import { randomUUID } from 'crypto';

export const app = express();
app.use(cors());

app.use(
    auth({
        authRequired: false,
        auth0Logout: true,
        secret: process.env.AUTH0_SECRET,
        baseURL: process.env.AUTH0_BASE_URL,
        clientID: process.env.AUTH0_CLIENT_ID,
        issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
        clientSecret: process.env.AUTH0_CLIENT_SECRET,
        authorizationParams: {
            response_type: 'code',
            scope: 'openid profile email',
        },
    })
);

app.get('/', requiresAuth(), (req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

app.use(express.static(join(__dirname, '../public')));
app.use(express.json());

const simulator = new DataStreamSimulator({
    updateIntervalMs: 1000,
    timeSpeedMinutesPerUpdate: 15,
    startClock: '08:00',
});

const streamBus = new EventEmitter();
const store = new GuidelinesStore();
const pgCtx = resolvePostgresContextConfig();
const agent = new EnergyAgent();
const actionLogger = new ActionLogger();
const errorLogger = new ErrorLogger();

let lastPrice = 0;
let lastTemp = 0;
let lastClock = '08:00';
let guidelines: Guideline[] = [];
let preferencesUnavailable = false;

interface ActionItem {
    action: string;
    reason: string;
    timestamp: string;
}

const MAX_GUIDELINES = 10;

let latestAction: ActionItem | null = null;
let actionHistory: ActionItem[] = [];

// Stale data tracking (Req 8.1)
const lastUpdated: Record<string, number> = { clock: 0, grid_price: 0, weather_temperature: 0 };
let lastStreamUpdateTime = 0;
let lastActionTime = 0;

// Individual stream events (for stale tracking and dashboard cards)
simulator.on('clock', (val: string) => {
    lastClock = val;
    lastUpdated.clock = Date.now();
    lastStreamUpdateTime = Date.now();
    streamBus.emit('event', { type: 'clock', data: val });
});
simulator.on('grid_price', (val: number) => {
    lastPrice = val;
    lastUpdated.grid_price = Date.now();
    lastStreamUpdateTime = Date.now();
    streamBus.emit('event', { type: 'grid_price', data: val });
});
simulator.on('weather_temperature', (val: number) => {
    lastTemp = val;
    lastUpdated.weather_temperature = Date.now();
    lastStreamUpdateTime = Date.now();
    streamBus.emit('event', { type: 'weather_temperature', data: val });
});

// Tick event — run agent decision cycle (Req 2)
simulator.on('tick', async (tick: TickPayload) => {
    try {
        const { row: external } = await fetchLatestExternalContextSafe(pgCtx.pool);
        agent.setGuidelines(toPreferenceGuidelines(guidelines));

        const decision = agent.decide({
            simulator: {
                clock: tick.clock,
                gridPrice: tick.gridPrice,
                weatherTemperature: tick.weatherTemperature,
            },
            external,
        });

        const appliedIds = agent.getLastAppliedGuidelineIds();
        for (const id of appliedIds) {
            await store.incrementApplied(id);
        }

        const newAction: ActionItem = {
            action: decision.action,
            reason: decision.reasonDetail,
            timestamp: new Date().toLocaleTimeString(),
        };

        latestAction = newAction;
        lastActionTime = Date.now();
        actionHistory.unshift(newAction);
        if (actionHistory.length > 20) actionHistory.pop();

        const guidelineIds = guidelines.map((g) => g.id);
        const estimatedRevenue = decision.action === 'SELL_TO_GRID' ? tick.gridPrice * 10 : undefined;
        await actionLogger.log({
            id: randomUUID(),
            action: decision.action,
            clock: tick.clock,
            gridPrice: tick.gridPrice,
            temperature: tick.weatherTemperature,
            estimatedRevenue,
            activeGuidelineIds: guidelineIds,
        });

        streamBus.emit('event', { type: 'action_issued', data: newAction });
        streamBus.emit('event', { type: 'history_updated', data: actionHistory });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Agent] Decision error:', message);
        await errorLogger.log({
            id: randomUUID(),
            message,
            stack: err instanceof Error ? err.stack : undefined,
            clock: lastClock,
            gridPrice: lastPrice,
            temperature: lastTemp,
        });
        streamBus.emit('event', { type: 'decision_error', message });
    }
});

// Stale data check (Req 8.1)
setInterval(() => {
    const now = Date.now();
    for (const stream of Object.keys(lastUpdated)) {
        if (lastUpdated[stream] > 0 && now - lastUpdated[stream] > 5000) {
            streamBus.emit('event', { type: 'stale_data', stream });
        }
    }
}, 2000);

// Decision timeout check (Req 6.6)
setInterval(() => {
    if (lastStreamUpdateTime > 0 && lastActionTime < lastStreamUpdateTime) {
        if (Date.now() - lastStreamUpdateTime > 2000) {
            streamBus.emit('event', { type: 'decision_timeout' });
        }
    }
}, 500);

// ====== AUTH ENDPOINTS ======
app.get('/api/me', requiresAuth(), (req: Request, res: Response) => {
    res.json(req.oidc.user);
});

// ====== SSE ENDPOINTS ======
app.get('/api/stream', requiresAuth(), (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`data: ${JSON.stringify({
        type: 'init',
        latestAction,
        actionHistory,
        guidelines,
        lastClock,
        lastPrice,
        lastTemp,
        preferencesUnavailable,
    })}\n\n`);

    const onEvent = (eventData: unknown) => {
        res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    };
    streamBus.on('event', onEvent);
    req.on('close', () => streamBus.off('event', onEvent));
});

app.post('/api/override', requiresAuth(), async (req: Request<object, object, { action?: string }>, res: Response) => {
    console.log('User Override requested!');
    // Use the action sent by the client (what the user actually saw) to avoid
    // the race condition where latestAction has already advanced to the next tick.
    const actionToOverride = (req.body.action ?? latestAction?.action) as Action | undefined;

    if (actionToOverride) {
        // Enforce guideline cap: drop oldest before adding new one.
        if (guidelines.length >= MAX_GUIDELINES) {
            const evicted = guidelines.shift()!;
            await store.remove(evicted.id);
        }
        const newGuideline = agent.applyPenalty(actionToOverride, {
            clock: lastClock,
            gridPrice: lastPrice,
            weatherTemperature: lastTemp,
        });
        await store.add(newGuideline);
        guidelines.push(newGuideline);
        agent.setGuidelines(toPreferenceGuidelines(guidelines));
        preferencesUnavailable = false;
        streamBus.emit('event', { type: 'guidelines_updated', data: guidelines });
    }

    latestAction = null;
    streamBus.emit('event', { type: 'override_success' });
    res.json({ success: true });
});

app.delete('/api/guidelines/:id', requiresAuth(), async (req: Request<{ id: string }>, res: Response) => {
    await store.remove(req.params.id);
    guidelines = guidelines.filter((g) => g.id !== req.params.id);
    streamBus.emit('event', { type: 'guidelines_updated', data: guidelines });
    res.json({ success: true });
});

const PORT = process.env.PORT ?? 3000;

export async function start(): Promise<void> {
    guidelines = await store.load();
    if (guidelines.length === 0) {
        preferencesUnavailable = true;
    }
    simulator.start();
    app.listen(PORT, () => {
        console.log(`Smart Grid Dashboard running on http://localhost:${PORT}`);
    });
}

if (require.main === module) {
    start();
}

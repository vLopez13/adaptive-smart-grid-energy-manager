import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { join } from 'path';
import { auth, requiresAuth } from 'express-openid-connect';
import { DataStreamSimulator, type TickPayload } from './simulator/DataStreamSimulator';
import { GuidelinesStore, type Guideline } from './store/GuidelinesStore';
import { EnergyAgent } from './agent/EnergyAgent';
import { toPreferenceGuidelines, toPreferenceGuideline } from './agent/guidelineAdapter';
import type { PreferenceGuideline } from './agent/PreferenceGuideline';
import { listProposalsInOrder } from './agent/decisionPolicy';
import { resolvePostgresContextConfig, fetchLatestExternalContextSafe } from './context/postgresPublicTest';
import { EventEmitter } from 'events';
import type { Action, DecisionContext } from './types/energy';
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
    updateIntervalMs: 3500,
    timeSpeedMinutesPerUpdate: 5,
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
let pausedUntil: number | null = null; // timestamp (ms) when pause expires, null if not paused

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
        // Check if paused and auto-resume if countdown expired (Req US-001)
        if (pausedUntil !== null && Date.now() >= pausedUntil) {
            pausedUntil = null;
            streamBus.emit('event', { type: 'pause_toggled', data: { paused: false, remainingMs: 0 } });
        }

        // Skip decision cycle if paused (Req US-001)
        if (pausedUntil !== null && Date.now() < pausedUntil) {
            return;
        }

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
        if (lastUpdated[stream] > 0 && now - lastUpdated[stream] > 12000) {
            streamBus.emit('event', { type: 'stale_data', stream });
        }
    }
}, 3000);

// Decision timeout check (Req 6.6)
setInterval(() => {
    if (lastStreamUpdateTime > 0 && lastActionTime < lastStreamUpdateTime) {
        if (Date.now() - lastStreamUpdateTime > 2000) {
            streamBus.emit('event', { type: 'decision_timeout' });
        }
    }
}, 500);

// Pause countdown broadcast (Req US-001)
setInterval(() => {
    const now = Date.now();
    if (pausedUntil !== null) {
        if (now >= pausedUntil) {
            pausedUntil = null;
            streamBus.emit('event', { type: 'pause_toggled', data: { paused: false, remainingMs: 0 } });
        } else {
            const remainingMs = pausedUntil - now;
            streamBus.emit('event', { type: 'pause_toggled', data: { paused: true, remainingMs } });
        }
    }
}, 1000);

// ====== AUTH ENDPOINTS ======
app.get('/api/me', requiresAuth(), (req: Request, res: Response) => {
    res.json(req.oidc.user);
});

// ====== SSE ENDPOINTS ======
app.get('/api/stream', requiresAuth(), (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const remainingMs = pausedUntil !== null ? Math.max(0, pausedUntil - Date.now()) : 0;
    res.write(`data: ${JSON.stringify({
        type: 'init',
        latestAction,
        actionHistory,
        guidelines,
        lastClock,
        lastPrice,
        lastTemp,
        preferencesUnavailable,
        paused: pausedUntil !== null && pausedUntil > Date.now(),
        remainingMs,
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

// Apply user-selected learning rules (Req US-005)
app.post('/api/apply-rules', requiresAuth(), async (req: Request<object, object, { ruleTexts?: string[] }>, res: Response) => {
    try {
        const { ruleTexts } = req.body;

        if (!Array.isArray(ruleTexts) || ruleTexts.length === 0) {
            return res.status(400).json({ error: 'ruleTexts must be a non-empty array' });
        }

        for (const ruleText of ruleTexts) {
            // Enforce guideline cap before adding each new rule
            if (guidelines.length >= MAX_GUIDELINES) {
                const evicted = guidelines.shift()!;
                await store.remove(evicted.id);
            }

            // Create guideline from rule text
            const newGuideline: Guideline = {
                id: randomUUID(),
                text: ruleText.trim(),
                createdAt: new Date().toISOString(),
                timesApplied: 0,
            };

            await store.add(newGuideline);
            guidelines.push(newGuideline);
        }

        agent.setGuidelines(toPreferenceGuidelines(guidelines));
        preferencesUnavailable = false;
        streamBus.emit('event', { type: 'guidelines_updated', data: guidelines });

        res.json({ success: true, rulesApplied: ruleTexts.length });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Apply Rules] Error:', message);
        res.status(500).json({ error: `Failed to apply rules: ${message}` });
    }
});

app.delete('/api/guidelines/:id', requiresAuth(), async (req: Request<{ id: string }>, res: Response) => {
    await store.remove(req.params.id);
    guidelines = guidelines.filter((g) => g.id !== req.params.id);
    streamBus.emit('event', { type: 'guidelines_updated', data: guidelines });
    res.json({ success: true });
});

// Pause decision cycle for 30 seconds (Req US-001)
app.post('/api/pause', requiresAuth(), (req: Request, res: Response) => {
    const PAUSE_DURATION_MS = 30000; // 30 seconds
    pausedUntil = Date.now() + PAUSE_DURATION_MS;
    streamBus.emit('event', { type: 'pause_toggled', data: { paused: true, remainingMs: PAUSE_DURATION_MS } });
    res.json({ success: true, pausedUntil, remainingMs: PAUSE_DURATION_MS });
});

// Resume decision cycle immediately (Req US-001)
app.post('/api/resume', requiresAuth(), (req: Request, res: Response) => {
    pausedUntil = null;
    streamBus.emit('event', { type: 'pause_toggled', data: { paused: false, remainingMs: 0 } });
    res.json({ success: true, paused: false });
});

// Preview what the agent will decide if a rule is applied (Req US-002)
interface PreviewDecisionResponse {
    blockedAction: string;
    topAlternatives: Array<{ action: string; reason: string; urgency: number }>;
    allBlocked?: boolean;
    warning?: string;
    error?: string;
}

function calculateUrgencyScore(action: string, ctx: DecisionContext): number {
    // Simple heuristic: higher score = more urgent
    // Based on decision policy principles
    const { clock, gridPrice, weatherTemperature: temp } = ctx.simulator;
    const hour = parseInt(clock.split(':')[0] ?? '0', 10);

    switch (action) {
        case 'SHUT_OFF_AC':
            return temp >= 82 ? 8 : temp >= 75 ? 5 : 2;
        case 'RESTORE_AC':
            return temp <= 48 ? 8 : temp <= 55 ? 5 : 2;
        case 'SELL_TO_GRID':
            return gridPrice >= 0.35 ? 8 : gridPrice >= 0.25 ? 5 : 2;
        case 'BUY_FROM_GRID':
            return gridPrice <= 0.10 ? 8 : gridPrice <= 0.15 ? 5 : 2;
        case 'CHARGE_EV_NOW':
            return gridPrice <= 0.10 ? 8 : gridPrice <= 0.15 ? 5 : (hour >= 23 || hour <= 5) ? 4 : 2;
        case 'PAUSE_EV_CHARGING':
            return gridPrice >= 0.35 ? 8 : temp >= 82 ? 5 : 2;
        case 'STORE_IN_BATTERY':
            return (hour >= 17 && hour <= 21) ? 6 : gridPrice >= 0.30 ? 5 : 3;
        case 'DISCHARGE_BATTERY':
            return (hour >= 17 && hour <= 21) ? 7 : gridPrice >= 0.35 ? 6 : 2;
        default:
            return 0;
    }
}

app.post('/api/preview-decision-with-rule', requiresAuth(), async (req: Request<object, object, { ruleText?: string; ruleTexts?: string[] }>, res: Response) => {
    try {
        const { ruleText, ruleTexts } = req.body;

        // Support both single rule (ruleText) and multiple rules (ruleTexts)
        const rulesToApply = ruleTexts && Array.isArray(ruleTexts) ? ruleTexts : (ruleText ? [ruleText] : []);

        if (rulesToApply.length === 0 || !rulesToApply.every(r => typeof r === 'string')) {
            return res.status(400).json({
                blockedAction: '',
                topAlternatives: [],
                error: 'Missing or invalid ruleText/ruleTexts parameter',
            } as PreviewDecisionResponse);
        }

        // Parse and validate rule texts using guidelineAdapter
        const tempGuidelines: Guideline[] = rulesToApply.map(text => ({
            id: 'temp-preview-' + randomUUID(),
            text: text.trim(),
            createdAt: new Date().toISOString(),
            timesApplied: 0,
        }));

        const preferenceGuidelines = tempGuidelines
            .map(g => toPreferenceGuideline(g))
            .filter((pg): pg is PreferenceGuideline => pg !== null);

        if (preferenceGuidelines.length !== rulesToApply.length) {
            return res.status(400).json({
                blockedAction: '',
                topAlternatives: [],
                error: 'One or more rules do not match expected format: "Do not {ACTION} when {FIELD} {OP} {VALUE}"',
            } as PreviewDecisionResponse);
        }

        // Create decision context with current stream data
        const ctx: DecisionContext = {
            simulator: {
                clock: lastClock,
                gridPrice: lastPrice,
                weatherTemperature: lastTemp,
            },
            external: null,
        };

        // Get all possible proposals in order of urgency
        const allProposals = listProposalsInOrder(ctx);

        // Collect all blocked actions from all rules
        const blockedActions = new Set(preferenceGuidelines.map(pg => pg.excludedAction));

        // Get top 3 allowed alternatives (excluding any blocked actions)
        const topAlternatives = allProposals
            .filter((p) => !blockedActions.has(p.action))
            .slice(0, 3)
            .map((p) => ({
                action: p.action,
                reason: p.reasonDetail,
                urgency: calculateUrgencyScore(p.action, ctx),
            }));

        // Check if all actions are blocked
        const allBlocked = topAlternatives.length === 0;

        // Show primary blocked action (or first one if multiple)
        const primaryBlockedAction = preferenceGuidelines[0]?.excludedAction || '';

        const response: PreviewDecisionResponse = {
            blockedAction: primaryBlockedAction,
            topAlternatives,
            ...(allBlocked && {
                allBlocked: true,
                warning: 'These rules block all actions. Agent will default to STORE_IN_BATTERY.',
            }),
        };

        res.json(response);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Preview] Error:', message);
        res.status(500).json({
            blockedAction: '',
            topAlternatives: [],
            error: `Internal error: ${message}`,
        } as PreviewDecisionResponse);
    }
});

const PORT = process.env.PORT ?? 3000;

export async function start(): Promise<void> {
    try {
        guidelines = await store.load();
    } catch (err) {
        console.warn('[Server] Guidelines Store unreachable, preference learning will be transient.');
        preferencesUnavailable = true;
    }
    simulator.start();
    app.listen(PORT, () => {
        console.log(`Lumera running on http://localhost:${PORT}`);
    });
}

if (require.main === module) {
    start();
}

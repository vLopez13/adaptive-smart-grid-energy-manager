import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { join } from 'path';
import { DataStreamSimulator } from './simulator/DataStreamSimulator';
import { GuidelinesStore, Guideline } from './store/GuidelinesStore';
import { EventEmitter } from 'events';

const app = express();
app.use(cors());
app.use(express.static(join(__dirname, '../public')));
app.use(express.json());

const simulator = new DataStreamSimulator({
    updateIntervalMs: 1000,
    timeSpeedMinutesPerUpdate: 15,
    startClock: '08:00',
});

const streamBus = new EventEmitter();
const store = new GuidelinesStore();

let lastPrice = 0;
let lastTemp = 0;
let lastClock = '08:00';
let guidelines: Guideline[] = [];
let preferencesUnavailable = false;

// Stale data tracking (Req 8.1)
const lastUpdated: Record<string, number> = { clock: 0, grid_price: 0, weather_temperature: 0 };

simulator.on('clock', (val: string) => {
    lastClock = val;
    lastUpdated.clock = Date.now();
    streamBus.emit('event', { type: 'clock', data: val });
});
simulator.on('grid_price', (val: number) => {
    lastPrice = val;
    lastUpdated.grid_price = Date.now();
    streamBus.emit('event', { type: 'grid_price', data: val });
});
simulator.on('weather_temperature', (val: number) => {
    lastTemp = val;
    lastUpdated.weather_temperature = Date.now();
    streamBus.emit('event', { type: 'weather_temperature', data: val });
});

setInterval(() => {
    const now = Date.now();
    for (const stream of Object.keys(lastUpdated)) {
        if (lastUpdated[stream] > 0 && now - lastUpdated[stream] > 5000) {
            streamBus.emit('event', { type: 'stale_data', stream });
        }
    }
}, 2000);

// ====== MOCK AGENT (removed when real Agent lands in Req 2) ======
interface ActionItem {
    action: string;
    reason: string;
    timestamp: string;
}

let latestAction: ActionItem | null = null;
let actionHistory: ActionItem[] = [];

setInterval(() => {
    const actions = ['SELL_TO_GRID', 'BUY_FROM_GRID', 'STORE_IN_BATTERY', 'DISCHARGE_BATTERY', 'SHUT_OFF_AC', 'RESTORE_AC', 'CHARGE_EV_NOW', 'PAUSE_EV_CHARGING'];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const newAction: ActionItem = {
        action,
        reason: `Grid Price was $${lastPrice.toFixed(3)} and Temperature was ${lastTemp.toFixed(1)}°F.`,
        timestamp: new Date().toLocaleTimeString(),
    };
    latestAction = newAction;
    actionHistory.unshift(newAction);
    if (actionHistory.length > 20) actionHistory.pop();
    streamBus.emit('event', { type: 'action_issued', data: newAction });
    streamBus.emit('event', { type: 'history_updated', data: actionHistory });
}, 7000);

// ====== SSE ENDPOINTS ======
app.get('/api/stream', (req: Request, res: Response) => {
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

app.post('/api/override', (_req: Request, res: Response) => {
    console.log('User Override requested!');
    latestAction = null;
    streamBus.emit('event', { type: 'override_success' });
    res.json({ success: true });
});

app.delete('/api/guidelines/:id', async (req: Request<{ id: string }>, res: Response) => {
    await store.remove(req.params.id);
    guidelines = guidelines.filter((g) => g.id !== req.params.id);
    streamBus.emit('event', { type: 'guidelines_updated', data: guidelines });
    res.json({ success: true });
});

const PORT = process.env.PORT ?? 3000;

async function start(): Promise<void> {
    guidelines = await store.load();
    if (guidelines.length === 0) {
        preferencesUnavailable = true;
    }
    simulator.start();
    app.listen(PORT, () => {
        console.log(`Smart Grid Dashboard running on http://localhost:${PORT}`);
    });
}

start();

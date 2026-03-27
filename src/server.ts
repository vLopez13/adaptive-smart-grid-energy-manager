// @ts-nocheck
import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { DataStreamSimulator } from './simulator/DataStreamSimulator';
import { EventEmitter } from 'events';

const app = express();
app.use(cors());
app.use(express.static(join(__dirname, '../public')));
app.use(express.json());

// Initialize simulator with 1 sec real-time updates = 15 min simulated time
const simulator = new DataStreamSimulator({
    updateIntervalMs: 1000,
    timeSpeedMinutesPerUpdate: 15,
    startClock: "08:00"
});

// Event bus for SSE broadcasting
const streamBus = new EventEmitter();

let lastPrice = 0;
let lastTemp = 0;
let lastClock = "08:00";

simulator.on('clock', (val) => { lastClock = val; streamBus.emit('event', { type: 'clock', data: val }); });
simulator.on('grid_price', (val) => { lastPrice = val; streamBus.emit('event', { type: 'grid_price', data: val }); });
simulator.on('weather_temperature', (val) => { lastTemp = val; streamBus.emit('event', { type: 'weather_temperature', data: val }); });

// Start emitting
simulator.start();

// ====== MOCK AGENT DATA FOR UI TESTING ======
let latestAction: any = null;
let actionHistory: any[] = [];
let guidelines: any[] = [
    { id: 'g1', text: 'Do not SHUT_OFF_AC when Temperature > 90°F' },
    { id: 'g2', text: 'Prioritize CHARGE_EV_NOW if Grid_Price < $0.10' }
];

// Replaces 5s random actions generator
setInterval(() => {
    const actions = ['SELL_TO_GRID', 'BUY_FROM_GRID', 'STORE_IN_BATTERY', 'DISCHARGE_BATTERY', 'SHUT_OFF_AC', 'RESTORE_AC', 'CHARGE_EV_NOW', 'PAUSE_EV_CHARGING'];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const newAction = {
        action,
        reason: `Grid Price was $${lastPrice.toFixed(3)} and Temperature was ${lastTemp.toFixed(1)}°F.`,
        timestamp: new Date().toLocaleTimeString()
    };
    latestAction = newAction;
    actionHistory.unshift(newAction);
    if(actionHistory.length > 20) actionHistory.pop();
    
    streamBus.emit('event', { type: 'action_issued', data: newAction });
    streamBus.emit('event', { type: 'history_updated', data: actionHistory });
}, 7000);

// ====== SSE REST ENDPOINTS ======
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Initial sync
    res.write(`data: ${JSON.stringify({ type: 'init', latestAction, actionHistory, guidelines, lastClock, lastPrice, lastTemp })}\n\n`);

    const onEvent = (eventData: any) => {
        res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    };
    streamBus.on('event', onEvent);

    req.on('close', () => {
        streamBus.off('event', onEvent);
    });
});

app.post('/api/override', (req, res) => {
    console.log("User Override requested!");
    latestAction = null;
    streamBus.emit('event', { type: 'override_success' });
    res.json({ success: true });
});

app.delete('/api/guidelines/:id', (req, res) => {
    guidelines = guidelines.filter(g => g.id !== req.params.id);
    streamBus.emit('event', { type: 'guidelines_updated', data: guidelines });
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Smart Grid Dashboard is running on http://localhost:${PORT}`);
});

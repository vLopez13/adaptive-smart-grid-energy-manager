import { DataStreamSimulator } from './simulator/DataStreamSimulator';

// Instantiate the simulator
// We set it to update every 1 second, and each update advances the clock by 15 simulation minutes.
// This allows us to see the clock progressing quickly.
const simulator = new DataStreamSimulator({
    updateIntervalMs: 1000,
    timeSpeedMinutesPerUpdate: 15, // 1 real second = 15 simulated minutes
    startClock: "08:00"
});

// We need to listen to all events to display them
// To simulate requirement 6 (Dashboard), we just log them here.

let lastClock = "";
let lastPrice = 0;
let lastTemp = 0;

console.log("Starting Smart-Grid Environment Simulation...");
console.log("---------------------------------------------");

// Listeners
simulator.on('clock', (val) => {
    lastClock = val;
    printDashboard();
});

simulator.on('grid_price', (val) => {
    lastPrice = val;
    // We only print on temperature to avoid 3 exact same logs per tick, since they emit together
});

simulator.on('weather_temperature', (val) => {
    lastTemp = val;
    // all streams emitted for this tick, print state
    printDashboard();
});

function printDashboard() {
    process.stdout.write(`\r[TIME: ${lastClock}] | Grid Price: $${lastPrice.toFixed(3)}/kWh | Temperature: ${lastTemp.toFixed(1)}°F   `);
}

// Ensure the process exits nicely
process.on('SIGINT', () => {
    console.log("\nStopping simulation...");
    simulator.stop();
    process.exit(0);
});

// Start the simulation
simulator.start();

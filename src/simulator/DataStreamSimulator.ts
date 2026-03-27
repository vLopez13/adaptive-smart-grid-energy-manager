import { EventEmitter } from 'events';

export interface SimulatorOptions {
    /** Update interval in milliseconds. Must be strictly >= 1000 */
    updateIntervalMs: number;
    /** How many simulated minutes pass per update interval */
    timeSpeedMinutesPerUpdate: number;
    /** Optional starting time, e.g. "08:00". Defaults to "00:00" */
    startClock?: string;
}

export class DataStreamSimulator extends EventEmitter {
    private intervalId: NodeJS.Timeout | null = null;
    private options: SimulatorOptions;
    
    // Internal state
    private currentMinutes: number = 0;
    private currentGridPrice: number = 0.15; // Starting default
    private currentTemperature: number = 70; // Starting default

    constructor(options: SimulatorOptions) {
        super();
        if (options.updateIntervalMs < 1000) {
            throw new Error("updateIntervalMs must be at least 1000ms (1 second).");
        }
        this.options = options;
        
        if (options.startClock) {
            const [hh, mm] = options.startClock.split(':').map(Number);
            this.currentMinutes = (hh * 60) + mm;
        }
    }

    /**
     * Initializes the streams and begins the simulation loop.
     */
    public start(): void {
        // Stop any existing simulation
        this.stop();

        // Initialize streams immediately (Requirement 1, AC 4)
        this.updateClock();
        this.updateGridPrice();
        this.updateWeatherTemperature();

        // Emit initial values
        this.emitValues();

        // Start interval
        this.intervalId = setInterval(() => {
            this.updateClock();
            this.updateGridPrice();
            this.updateWeatherTemperature();
            this.emitValues();
        }, this.options.updateIntervalMs);
    }

    /**
     * Stops the simulation.
     */
    public stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    private emitValues(): void {
        this.emit('clock', this.getFormattedClock());
        this.emit('grid_price', this.currentGridPrice);
        this.emit('weather_temperature', this.currentTemperature);
    }

    private updateClock(): void {
        this.currentMinutes += this.options.timeSpeedMinutesPerUpdate;
        // Wrap around 24 hours (1440 minutes)
        if (this.currentMinutes >= 1440) {
            this.currentMinutes = this.currentMinutes % 1440;
        }
    }

    private updateGridPrice(): void {
        // Grid price between $0.05 and $0.50 per kWh
        // Random walk to make it somewhat realistic, or just purely random
        const change = (Math.random() - 0.5) * 0.1; // -0.05 to +0.05 change
        let nextPrice = this.currentGridPrice + change;
        
        // Clamp to $0.05 - $0.50
        nextPrice = Math.max(0.05, Math.min(0.50, nextPrice));
        // Round to 3 decimal places
        this.currentGridPrice = Math.round(nextPrice * 1000) / 1000;
    }

    private updateWeatherTemperature(): void {
        // Temperature between 20°F and 115°F
        const change = (Math.random() - 0.5) * 2; // -1.0 to +1.0 change
        let nextTemp = this.currentTemperature + change;
        
        // Clamp to 20 - 115
        nextTemp = Math.max(20, Math.min(115, nextTemp));
        this.currentTemperature = Math.round(nextTemp * 10) / 10;
    }

    /**
     * Returns current clock in HH:MM format
     */
    private getFormattedClock(): string {
        const hh = Math.floor(this.currentMinutes / 60);
        const mm = Math.floor(this.currentMinutes % 60);
        
        const hhStr = hh.toString().padStart(2, '0');
        const mmStr = mm.toString().padStart(2, '0');
        
        return `${hhStr}:${mmStr}`;
    }
}

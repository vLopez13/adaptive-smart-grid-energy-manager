import { DataStreamSimulator } from './DataStreamSimulator';

describe('DataStreamSimulator', () => {
    let simulator: DataStreamSimulator;

    afterEach(() => {
        if (simulator) {
            simulator.stop();
        }
    });

    test('throws if updateIntervalMs is less than 1000', () => {
        expect(() => new DataStreamSimulator({
            updateIntervalMs: 500,
            timeSpeedMinutesPerUpdate: 1
        })).toThrow();
    });

    test('initializes and emits values on start', () => {
        simulator = new DataStreamSimulator({
            updateIntervalMs: 1000,
            timeSpeedMinutesPerUpdate: 10,
            startClock: "12:00"
        });

        // Use mock functions to spy on emissions
        const clockSpy = jest.fn();
        const priceSpy = jest.fn();
        const tempSpy = jest.fn();

        simulator.on('clock', clockSpy);
        simulator.on('grid_price', priceSpy);
        simulator.on('weather_temperature', tempSpy);

        // Start should trigger immediate emission
        simulator.start();

        expect(clockSpy).toHaveBeenCalledTimes(1);
        expect(clockSpy).toHaveBeenCalledWith("12:10"); // since updateClock adds time Speed immediately on first tick in start?
        
        expect(priceSpy).toHaveBeenCalledTimes(1);
        expect(tempSpy).toHaveBeenCalledTimes(1);

        const emittedPrice = priceSpy.mock.calls[0][0];
        const emittedTemp = tempSpy.mock.calls[0][0];

        expect(emittedPrice).toBeGreaterThanOrEqual(0.05);
        expect(emittedPrice).toBeLessThanOrEqual(0.50);

        expect(emittedTemp).toBeGreaterThanOrEqual(20);
        expect(emittedTemp).toBeLessThanOrEqual(115);
    });

    test('values remain within bounds over time', () => {
        simulator = new DataStreamSimulator({
            updateIntervalMs: 1000,
            timeSpeedMinutesPerUpdate: 1
        });

        // We can artificially call private methods since this is JS underneath, or we can just mock timers
        jest.useFakeTimers();

        const priceSpy = jest.fn();
        const tempSpy = jest.fn();

        simulator.on('grid_price', priceSpy);
        simulator.on('weather_temperature', tempSpy);

        simulator.start();

        // Advance by 100 intervals
        jest.advanceTimersByTime(100 * 1000);

        simulator.stop();

        // Expect 1 + 100 calls
        expect(priceSpy).toHaveBeenCalledTimes(101);

        for (const call of priceSpy.mock.calls) {
            expect(call[0]).toBeGreaterThanOrEqual(0.05);
            expect(call[0]).toBeLessThanOrEqual(0.50);
        }

        for (const call of tempSpy.mock.calls) {
            expect(call[0]).toBeGreaterThanOrEqual(20);
            expect(call[0]).toBeLessThanOrEqual(115);
        }

        jest.useRealTimers();
    });
});

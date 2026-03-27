import { DataStreamSimulator } from './DataStreamSimulator';

describe('DataStreamSimulator', () => {
    let simulator: DataStreamSimulator;

    afterEach(() => {
        if (simulator) {
            simulator.stop();
        }
    });

    test('throws if updateIntervalMs is less than 1000', () => {
        expect(
            () =>
                new DataStreamSimulator({
                    updateIntervalMs: 500,
                    timeSpeedMinutesPerUpdate: 1,
                })
        ).toThrow();
    });

    test('initializes and emits values on start', () => {
        simulator = new DataStreamSimulator({
            updateIntervalMs: 1000,
            timeSpeedMinutesPerUpdate: 10,
            startClock: '12:00',
        });

        const clockSpy = jest.fn();
        const priceSpy = jest.fn();
        const tempSpy = jest.fn();

        simulator.on('clock', clockSpy);
        simulator.on('grid_price', priceSpy);
        simulator.on('weather_temperature', tempSpy);

        simulator.start();

        expect(clockSpy).toHaveBeenCalledTimes(1);
        expect(clockSpy).toHaveBeenCalledWith('12:10');

        expect(priceSpy).toHaveBeenCalledTimes(1);
        expect(tempSpy).toHaveBeenCalledTimes(1);

        const emittedPrice = priceSpy.mock.calls[0][0];
        const emittedTemp = tempSpy.mock.calls[0][0];

        expect(emittedPrice).toBeGreaterThanOrEqual(0.05);
        expect(emittedPrice).toBeLessThanOrEqual(0.5);

        expect(emittedTemp).toBeGreaterThanOrEqual(20);
        expect(emittedTemp).toBeLessThanOrEqual(115);
    });

    test('emits tick once per cycle with aligned snapshot', () => {
        simulator = new DataStreamSimulator({
            updateIntervalMs: 1000,
            timeSpeedMinutesPerUpdate: 5,
            startClock: '09:00',
        });
        const tickSpy = jest.fn();
        simulator.on('tick', tickSpy);
        simulator.start();
        expect(tickSpy).toHaveBeenCalledTimes(1);
        const p = tickSpy.mock.calls[0][0];
        expect(p.clock).toBe('09:05');
        expect(typeof p.gridPrice).toBe('number');
        expect(typeof p.weatherTemperature).toBe('number');
    });

    test('values remain within bounds over time', () => {
        simulator = new DataStreamSimulator({
            updateIntervalMs: 1000,
            timeSpeedMinutesPerUpdate: 1,
        });

        jest.useFakeTimers();

        const priceSpy = jest.fn();
        const tempSpy = jest.fn();

        simulator.on('grid_price', priceSpy);
        simulator.on('weather_temperature', tempSpy);

        simulator.start();

        jest.advanceTimersByTime(100 * 1000);

        simulator.stop();

        expect(priceSpy).toHaveBeenCalledTimes(101);

        for (const call of priceSpy.mock.calls) {
            expect(call[0]).toBeGreaterThanOrEqual(0.05);
            expect(call[0]).toBeLessThanOrEqual(0.5);
        }

        for (const call of tempSpy.mock.calls) {
            expect(call[0]).toBeGreaterThanOrEqual(20);
            expect(call[0]).toBeLessThanOrEqual(115);
        }

        jest.useRealTimers();
    });
});

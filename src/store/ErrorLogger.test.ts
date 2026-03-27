import { ErrorLogger, ErrorLogEntry } from './ErrorLogger';
import { Pool } from 'pg';

function makeMockPool(mockQuery: jest.Mock): Pool {
    return { query: mockQuery } as unknown as Pool;
}

const baseEntry: ErrorLogEntry = {
    id: 'err-uuid-1',
    message: 'Agent decision failed',
    clock: '10:00',
    gridPrice: 0.20,
    temperature: 85,
};

describe('ErrorLogger', () => {
    describe('log()', () => {
        it('calls CREATE TABLE IF NOT EXISTS and INSERT with correct values', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const logger = new ErrorLogger(makeMockPool(mockQuery));

            await logger.log(baseEntry);

            expect(mockQuery).toHaveBeenCalledTimes(2);
            expect(mockQuery).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining('CREATE TABLE IF NOT EXISTS error_log')
            );
            expect(mockQuery).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('INSERT INTO error_log'),
                [
                    baseEntry.id,
                    baseEntry.message,
                    null,
                    baseEntry.clock,
                    baseEntry.gridPrice,
                    baseEntry.temperature,
                ]
            );
        });

        it('includes stack when provided', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const logger = new ErrorLogger(makeMockPool(mockQuery));

            const entryWithStack: ErrorLogEntry = {
                ...baseEntry,
                stack: 'Error: Agent decision failed\n    at EnergyAgent.decide (EnergyAgent.ts:42)',
            };

            await logger.log(entryWithStack);

            const insertCall = mockQuery.mock.calls[1];
            const params = insertCall[1];
            expect(params[2]).toBe(entryWithStack.stack);
        });

        it('does not throw when pool.query rejects (graceful failure)', async () => {
            const mockQuery = jest.fn().mockRejectedValue(new Error('DB connection lost'));
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const logger = new ErrorLogger(makeMockPool(mockQuery));

            await expect(logger.log(baseEntry)).resolves.toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[ErrorLogger]'),
                expect.stringContaining('DB connection lost')
            );

            warnSpy.mockRestore();
        });

        it('sets stack to null when not provided', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const logger = new ErrorLogger(makeMockPool(mockQuery));

            await logger.log(baseEntry);

            const insertCall = mockQuery.mock.calls[1];
            const params = insertCall[1];
            expect(params[2]).toBeNull();
        });
    });
});

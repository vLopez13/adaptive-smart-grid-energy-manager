import { ActionLogger, ActionLogEntry } from './ActionLogger';
import { Pool } from 'pg';

function makeMockPool(mockQuery: jest.Mock): Pool {
    return { query: mockQuery } as unknown as Pool;
}

const baseEntry: ActionLogEntry = {
    id: 'test-uuid-1',
    action: 'STORE_IN_BATTERY',
    clock: '10:00',
    gridPrice: 0.15,
    temperature: 72,
    activeGuidelineIds: ['g1', 'g2'],
};

describe('ActionLogger', () => {
    describe('log()', () => {
        it('calls CREATE TABLE IF NOT EXISTS and INSERT with correct values', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const logger = new ActionLogger(makeMockPool(mockQuery));

            await logger.log(baseEntry);

            expect(mockQuery).toHaveBeenCalledTimes(2);
            expect(mockQuery).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining('CREATE TABLE IF NOT EXISTS action_log')
            );
            expect(mockQuery).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('INSERT INTO action_log'),
                [
                    baseEntry.id,
                    baseEntry.action,
                    baseEntry.clock,
                    baseEntry.gridPrice,
                    baseEntry.temperature,
                    null,
                    baseEntry.activeGuidelineIds,
                ]
            );
        });

        it('includes estimated_revenue for SELL_TO_GRID (gridPrice * 10)', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const logger = new ActionLogger(makeMockPool(mockQuery));

            const sellEntry: ActionLogEntry = {
                ...baseEntry,
                action: 'SELL_TO_GRID',
                estimatedRevenue: 0.15 * 10,
            };

            await logger.log(sellEntry);

            expect(mockQuery).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('INSERT INTO action_log'),
                [
                    sellEntry.id,
                    sellEntry.action,
                    sellEntry.clock,
                    sellEntry.gridPrice,
                    sellEntry.temperature,
                    1.5,
                    sellEntry.activeGuidelineIds,
                ]
            );
        });

        it('passes null for estimated_revenue when action is not SELL_TO_GRID', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const logger = new ActionLogger(makeMockPool(mockQuery));

            await logger.log(baseEntry);

            const insertCall = mockQuery.mock.calls[1];
            const params = insertCall[1];
            expect(params[5]).toBeNull();
        });

        it('does not throw when pool.query rejects (graceful failure)', async () => {
            const mockQuery = jest.fn().mockRejectedValue(new Error('connection refused'));
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const logger = new ActionLogger(makeMockPool(mockQuery));

            await expect(logger.log(baseEntry)).resolves.toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[ActionLogger]'),
                expect.stringContaining('connection refused')
            );

            warnSpy.mockRestore();
        });

        it('passes activeGuidelineIds as array', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const logger = new ActionLogger(makeMockPool(mockQuery));

            const entryWithGuidelineIds: ActionLogEntry = {
                ...baseEntry,
                activeGuidelineIds: ['g1', 'g2', 'g3'],
            };

            await logger.log(entryWithGuidelineIds);

            const insertCall = mockQuery.mock.calls[1];
            const params = insertCall[1];
            expect(params[6]).toEqual(['g1', 'g2', 'g3']);
        });
    });
});

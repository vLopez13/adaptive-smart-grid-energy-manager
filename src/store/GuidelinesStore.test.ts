import { GuidelinesStore, Guideline } from './GuidelinesStore';
import { Pool } from 'pg';

const sampleGuideline: Guideline = {
    id: 'g1',
    text: 'Do not SHUT_OFF_AC when Temperature > 90°F',
    createdAt: '2026-03-27T00:00:00.000Z',
    timesApplied: 0,
};

function makeMockPool(queryImpl?: jest.Mock): Pool {
    const mockQuery = queryImpl ?? jest.fn().mockResolvedValue({ rows: [] });
    return { query: mockQuery } as unknown as Pool;
}

describe('GuidelinesStore', () => {
    describe('load()', () => {
        it('returns mapped guidelines from the DB', async () => {
            const mockQuery = jest.fn()
                .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: 'g1',
                            text: 'Do not SHUT_OFF_AC when Temperature > 90°F',
                            created_at: new Date('2026-03-27T00:00:00.000Z'),
                            times_applied: 3,
                        },
                    ],
                });

            const store = new GuidelinesStore(makeMockPool(mockQuery));
            const result = await store.load();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                id: 'g1',
                text: 'Do not SHUT_OFF_AC when Temperature > 90°F',
                createdAt: '2026-03-27T00:00:00.000Z',
                timesApplied: 3,
            });
        });

        it('returns empty array and logs warning when DB is unreachable', async () => {
            const mockQuery = jest.fn().mockRejectedValue(new Error('connection refused'));
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            const store = new GuidelinesStore(makeMockPool(mockQuery));
            const result = await store.load();

            expect(result).toEqual([]);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[GuidelinesStore]'),
                expect.stringContaining('connection refused')
            );
            warnSpy.mockRestore();
        });
    });

    describe('add()', () => {
        it('inserts the guideline into the DB', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const store = new GuidelinesStore(makeMockPool(mockQuery));

            await store.add(sampleGuideline);

            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO preference_guidelines'),
                ['g1', sampleGuideline.text, sampleGuideline.createdAt, 0]
            );
        });
    });

    describe('remove()', () => {
        it('deletes the guideline by id', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const store = new GuidelinesStore(makeMockPool(mockQuery));

            await store.remove('g1');

            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM preference_guidelines WHERE id'),
                ['g1']
            );
        });
    });

    describe('incrementApplied()', () => {
        it('increments times_applied for the given id', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const store = new GuidelinesStore(makeMockPool(mockQuery));

            await store.incrementApplied('g1');

            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('times_applied = times_applied + 1'),
                ['g1']
            );
        });
    });

    describe('clear()', () => {
        it('deletes all guidelines', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            const store = new GuidelinesStore(makeMockPool(mockQuery));

            await store.clear();

            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM preference_guidelines')
            );
        });
    });
});

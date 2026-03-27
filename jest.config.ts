import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/*.test.ts'],
    moduleNameMapper: {
        '^uuid$': '<rootDir>/src/__mocks__/uuid.ts',
    },
};

export default config;

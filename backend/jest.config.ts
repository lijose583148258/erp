export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    passWithNoTests: true,
    testMatch: [
        '<rootDir>/src/**/*.test.ts',
        '<rootDir>/tests/**/*.test.ts',
    ],
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};

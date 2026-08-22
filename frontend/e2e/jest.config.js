/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.e2e.ts'],
  testTimeout: 300_000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  testEnvironment: 'detox/runners/jest/testEnvironment',
  reporters: ['detox/runners/jest/reporter'],
  verbose: true,

  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/e2e/tsconfig.json' }],
  },

  // The suite imports `@/constants/testIDs` — the same module the app renders
  // from — so a renamed id is a compile error here rather than a matcher that
  // silently never matches.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

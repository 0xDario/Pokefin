const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jsdom',
  // jsdom 26 (shipped with jest-environment-jsdom 30) makes window.location
  // non-configurable. Set the origin here instead of redefining it in setup.
  testEnvironmentOptions: {
    url: 'http://localhost:3000/',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // scripts/ holds Node build tooling tested with `node --test` (pnpm test:scripts).
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/scripts/'],
  collectCoverageFrom: [
    'app/**/*.{js,jsx,ts,tsx}',
    '!app/**/*.d.ts',
    '!app/**/layout.tsx',
    '!app/**/page.tsx',
  ],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);

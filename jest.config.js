/**
 * Four projects, one runner.
 *
 *   unit        — node, no DOM, no Firebase. Pure game rules and helpers.
 *                 Files: src/game/**\/*.test.js, src/utils/**\/*.test.js, functions/**\/*.test.js
 *   dom         — jsdom + Testing Library. Mostly React components, but
 *                 also any non-component test that needs jsdom's DOM APIs
 *                 (e.g. Canvas) — see src/utils/compressImage.test.jsx.
 *                 Files: src/**\/*.test.jsx
 *   integration — node, real dbCalls against the Firestore emulator.
 *                 Files: src/**\/*.integration.test.js
 *   rules       — node, Firestore security rules against the emulator, via
 *                 @firebase/rules-unit-testing. Files: test/**\/*.rules.test.js
 *
 * The filename suffix routes a test to an environment. A test that needs a DOM
 * is `.test.jsx`; one that needs the emulator is `.integration.test.js` or
 * `.rules.test.js`.
 *
 * `npm test` runs unit + dom only, so the default loop needs no emulator.
 * `npm run test:emulator` starts the emulator and runs the integration project.
 * `npm run test:rules` starts the emulator and runs the rules project.
 *
 * See docs/testing.md for what belongs in each layer.
 */

/** @type {import('jest').Config} */
const config = {
    projects: [
        {
            displayName: 'unit',
            testEnvironment: 'node',
            clearMocks: true,
            testMatch: [
                '<rootDir>/src/game/**/*.test.js',
                '<rootDir>/src/utils/**/*.test.js',
                '<rootDir>/functions/**/*.test.js',
            ],
            testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.js$'],
        },
        {
            displayName: 'dom',
            testEnvironment: 'jsdom',
            clearMocks: true,
            testMatch: ['<rootDir>/src/**/*.test.jsx'],
            testPathIgnorePatterns: ['/node_modules/'],
            setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
            moduleNameMapper: {
                '\\.(css|less|scss)$': '<rootDir>/test/styleStub.js',
                '\\.(png|jpe?g|gif|svg|webp|avif)$': '<rootDir>/test/fileStub.js',
            },
        },
        {
            displayName: 'integration',
            testEnvironment: 'node',
            clearMocks: true,
            testMatch: [
                '<rootDir>/src/**/*.integration.test.js',
                '<rootDir>/functions/**/*.integration.test.js',
            ],
            testPathIgnorePatterns: ['/node_modules/'],
            // Must be setupFiles, not setupFilesAfterEnv: the env vars have to be in
            // place before src/utils/firebase.js is first imported.
            setupFiles: ['<rootDir>/test/integrationSetup.js'],
            setupFilesAfterEnv: ['<rootDir>/test/integrationTimeout.js'],
        },
        {
            displayName: 'rules',
            testEnvironment: 'node',
            clearMocks: true,
            testMatch: ['<rootDir>/test/**/*.rules.test.js'],
            testPathIgnorePatterns: ['/node_modules/'],
            setupFilesAfterEnv: ['<rootDir>/test/integrationTimeout.js'],
        },
    ],

    // Coverage is opt-in via `npm run test:coverage`. Collecting it on every run
    // in a repo this early just prints a wall of 0%.
    coverageDirectory: 'coverage',
    collectCoverageFrom: ['src/game/**/*.js', 'src/utils/**/*.js', '!src/**/*.test.js'],
};

module.exports = config;

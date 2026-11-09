export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["<rootDir>/tests/integration/**/*.integration.js"],
  setupFiles: ["<rootDir>/tests/integration/setupEnvironment.js"],
  globalSetup: "<rootDir>/tests/integration/globalSetup.js",
  globalTeardown: "<rootDir>/tests/integration/globalTeardown.js",
  maxWorkers: 1,
  collectCoverage: false,
};

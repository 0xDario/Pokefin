import "@testing-library/jest-dom";

// window.location.origin is provided by jest-environment-jsdom and configured
// via testEnvironmentOptions.url in jest.config.js (jsdom 26 made the
// location object non-configurable, so we no longer redefine it here).

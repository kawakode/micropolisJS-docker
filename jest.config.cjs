// One TypeScript configuration for every file jest transforms: the game (src/, test/) and the server (server/)
const transformer = ["ts-jest", {tsconfig: "<rootDir>/tsconfig.jest.json"}];

module.exports = {
  collectCoverage: true,
  collectCoverageFrom: [
    "src/**/*.ts",
    "test/**/*.ts",
    "server/**/*.ts",
  ],
  coverageReporters: ["json", "lcov", "text", "html"],
  moduleFileExtensions: [
    "ts",
    "js",
  ],
  roots: [
    "<rootDir>/src",
    "<rootDir>/test",
    "<rootDir>/server",
  ],
  testEnvironment: "node",
  testMatch: ["**/test/*.ts", "**/test/**/*.ts"],
  transform: {
    "^.+\\.ts$": transformer,
    // The game is mostly JavaScript (ES modules): its tools are tested too
    "^.+\\.js$": transformer
  }
};
